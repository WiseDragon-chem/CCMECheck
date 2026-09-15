/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 开发环境留空走 Vite 代理；生产环境同样应保持与 API 同源 */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
