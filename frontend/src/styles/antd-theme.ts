import type { ThemeConfig } from 'antd'

/**
 * antd 默认主题是按桌面调的：控件高度 32px、字号 14px。
 * 参赛者端是手机优先，32px 的按钮在触屏上点不准 ——
 * 这里把默认控件高度抬到 40px、大号抬到 48px，
 * 都落在常见触控目标建议区间的上沿。
 *
 * 管理后台沿用同一套 token（它本来就是桌面端，变大一点也不影响使用）。
 */
export const themeConfig: ThemeConfig = {
  token: {
    colorPrimary: '#1677ff',
    borderRadius: 8,
    fontSize: 15,
    controlHeight: 40,
    controlHeightLG: 48,
    controlHeightSM: 32,
    // 中文字体栈优先用系统自带的，避免额外下载字体文件
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
  },
  components: {
    Button: {
      controlHeight: 40,
      controlHeightLG: 48,
      // 手机上的主要操作用大按钮
      paddingInlineLG: 24,
    },
    Card: {
      paddingLG: 16,
    },
    Form: {
      // 手机表单字段之间留够间距，减少误触
      itemMarginBottom: 20,
    },
    Message: {
      contentPadding: '10px 16px',
    },
  },
}
