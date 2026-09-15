/**
 * 提交打卡的幂等键（design.md §7.4「提交接口需要防止重复点击产生重复记录」）。
 *
 * 关键约束：**每次「提交动作」生成一个新的**，成功之后才重新生成。
 *
 * 如果固定成一个值，第二次提交会被服务端判定为重复提交而**静默返回旧版本** ——
 * 用户以为重新提交成功了，实际什么都没变。这是本产品最容易埋下的一类 bug：
 * 没有任何报错，只是数据不动。
 */
export function newClientToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // 局域网 http 环境下 randomUUID 可能不可用（非安全上下文），退化为随机串
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}
