/**
 * `png.mjs` 的类型声明。
 *
 * 那个模块被播种脚本（.mjs）与端到端测试（.ts）共用，所以保持纯 JS，
 * 用一份声明文件给 TS 侧提供类型 —— 比为了类型安全把它改成 TS、
 * 再让 .mjs 去 import 编译产物要简单得多。
 */

/** 生成一张带渐变的真彩 PNG，返回可直接上传或写盘的字节 */
export function makePng(width: number, height: number, color: [number, number, number]): Buffer
