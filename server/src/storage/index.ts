import { env } from '../config/env.js'
import { LocalStorage } from './local.js'

/**
 * 私有文件存储抽象（design.md §13）。
 *
 * 首期是本机私有目录，通过这层接口隔离，后续替换为 S3 兼容对象存储
 * 只需新增一个实现类，调用方无需改动。
 */
export interface Storage {
  /** 写入对象。key 由调用方提供，必须是不含用户信息的随机标识。 */
  put(key: string, data: Buffer): Promise<void>
  get(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  /** 列出全部对象键，供孤儿上传清理使用 */
  list(prefix?: string): Promise<string[]>
  /** 返回对象的最后修改时间，供宽限期判断使用 */
  stat(key: string): Promise<{ size: number; modifiedAt: Date }>
  /**
   * 可选：清理临时区中超过指定时间的文件。
   * 只有提供临时区的实现才需要实现（本机存储有，对象存储通常没有）。
   */
  cleanupTmp?(olderThan: Date): Promise<number>
}

export type { LocalStorage }

let storage: Storage | null = null

export function getStorage(): Storage {
  if (!storage) storage = new LocalStorage(env.storageRoot)
  return storage
}

export function setStorage(implementation: Storage): void {
  storage = implementation
}
