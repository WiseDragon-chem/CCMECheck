import zlib from 'node:zlib'

/**
 * 极简 PNG 编码器。
 *
 * 播种脚本与端到端测试都需要真实可解码的图片字节，但都不该为此引入 sharp：
 * PNG 的 IDAT 只是 zlib 压缩过的扫描线，Node 自带 zlib，CRC32 二十行就够。
 *
 * 生成的是渐变色块而不是纯色 —— 纯色看不出宽高比，也没有视觉信号表明
 * 「这张图确实被解码并渲染了」。实测时我就是靠它一眼看出图片有没有加载出来。
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}

/**
 * 生成一张带渐变的真彩 PNG。
 *
 * @param {number} width
 * @param {number} height
 * @param {[number, number, number]} rgb 基础色
 * @returns {Buffer}
 */
export function makePng(width, height, [r, g, b]) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // 位深
  ihdr[9] = 2 // 颜色类型：真彩 RGB

  // 每行前面加一个 filter 字节（0 = None）
  const stride = width * 3
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1)
    raw[rowStart] = 0
    for (let x = 0; x < width; x++) {
      const p = rowStart + 1 + x * 3
      raw[p] = (r + x) % 256
      raw[p + 1] = (g + y) % 256
      raw[p + 2] = b
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
