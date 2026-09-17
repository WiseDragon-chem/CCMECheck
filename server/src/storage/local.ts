import fs from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '../core/errors.js'
import type { Storage } from './index.js'

/**
 * 对象键只允许 <2 位十六进制分片>/<十六进制串> 的形式。
 * 这是路径穿越防护的第一道关：即使上游逻辑被绕过，
 * 不合法的键也无法解析到存储根目录之外。
 */
const OBJECT_KEY_PATTERN = /^[a-f0-9]{2}\/[a-f0-9]{8,}$/

/** 临时区（预览落盘的 CSV 等），与正式对象分开存放 */
const TMP_SEGMENT = '_tmp'

export function isValidObjectKey(key: string): boolean {
  return OBJECT_KEY_PATTERN.test(key)
}

export class LocalStorage implements Storage {
  constructor(private readonly root: string) {}

  /** 把对象键解析成绝对路径，并确保结果仍在存储根目录内 */
  private resolveKey(key: string): string {
    if (!isValidObjectKey(key)) {
      throw new AppError('VALIDATION_FAILED', '对象标识不合法')
    }
    const resolved = path.resolve(this.root, 'objects', key)
    const base = path.resolve(this.root, 'objects')
    // 二次确认，防止将来放宽 key 规则时引入穿越漏洞
    if (resolved !== base && !resolved.startsWith(base + path.sep)) {
      throw new AppError('VALIDATION_FAILED', '对象标识不合法')
    }
    return resolved
  }

  private async ensureDir(filePath: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
  }

  async put(key: string, data: Buffer): Promise<void> {
    const filePath = this.resolveKey(key)
    await this.ensureDir(filePath)
    await fs.writeFile(filePath, data)
  }

  async get(key: string): Promise<Buffer> {
    const filePath = this.resolveKey(key)
    try {
      return await fs.readFile(filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new AppError('NOT_FOUND', '文件不存在')
      }
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolveKey(key)
    try {
      await fs.unlink(filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolveKey(key))
      return true
    } catch {
      return false
    }
  }

  async stat(key: string): Promise<{ size: number; modifiedAt: Date }> {
    const filePath = this.resolveKey(key)
    try {
      const info = await fs.stat(filePath)
      return { size: info.size, modifiedAt: info.mtime }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new AppError('NOT_FOUND', '文件不存在')
      }
      throw error
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const base = path.resolve(this.root, 'objects')
    const keys: string[] = []

    const walk = async (dir: string): Promise<void> => {
      let entries
      try {
        entries = await fs.readdir(dir, { withFileTypes: true, encoding: 'utf8' })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(full)
        } else {
          const relative = path.relative(base, full).split(path.sep).join('/')
          if (!prefix || relative.startsWith(prefix)) keys.push(relative)
        }
      }
    }

    await walk(base)
    return keys
  }

  // -------------------------------------------------------------------------
  // 临时区：名单导入预览的原始 CSV 暂存于此（design.md §7.1）
  // -------------------------------------------------------------------------

  async putTmp(name: string, data: Buffer): Promise<string> {
    const safeName = `${Date.now()}-${name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-64)}`
    const filePath = path.resolve(this.root, TMP_SEGMENT, safeName)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, data)
    return filePath
  }

  async readTmp(filePath: string): Promise<Buffer> {
    const base = path.resolve(this.root, TMP_SEGMENT)
    const resolved = path.resolve(filePath)
    if (!resolved.startsWith(base + path.sep)) {
      throw new AppError('VALIDATION_FAILED', '临时文件路径不合法')
    }
    return fs.readFile(resolved)
  }

  /** 删除临时区中超过指定时间的文件，返回删除数量 */
  async cleanupTmp(olderThan: Date): Promise<number> {
    const stale = await this.listStaleTmp(olderThan)
    let removed = 0
    for (const filePath of stale) {
      try {
        await fs.unlink(filePath)
        removed += 1
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    return removed
  }

  /** 列出临时区中超过宽限期的文件绝对路径 */
  async listStaleTmp(olderThan: Date): Promise<string[]> {
    const dir = path.resolve(this.root, TMP_SEGMENT)
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true, encoding: 'utf8' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }

    const stale: string[] = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const full = path.join(dir, entry.name)
      const info = await fs.stat(full)
      if (info.mtime < olderThan) stale.push(full)
    }
    return stale
  }
}
