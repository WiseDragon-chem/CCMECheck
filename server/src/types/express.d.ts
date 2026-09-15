import type { Logger } from 'pino'
import type { AuthPrincipal } from '../core/principal.js'

declare global {
  namespace Express {
    interface Request {
      /** 由 request-id 中间件注入，出现在响应头、错误体与日志中 */
      id: string
      /** 绑定 request_id 的子日志器 */
      log: Logger
      /** 通过访问令牌解析出的调用方；未认证接口上为 undefined */
      principal?: AuthPrincipal
      /** 校验后的原始文件缓冲，供图片流水线使用 */
      uploadBuffers?: Map<string, Buffer>
    }
  }
}

export {}
