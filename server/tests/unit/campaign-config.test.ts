import { describe, expect, it } from 'vitest'
import {
  CAMPAIGN_CONFIG,
  applyableFields,
  diffFields,
  validateCampaignConfig,
  type CampaignConfig,
} from '../../src/config/campaign.js'

/**
 * 活动配置与它的校验（design.md §8.4 被取消后的替代）。
 *
 * 规则写在代码里，改它的唯一手段就是改这个文件再部署 —— 也就是说
 * 这些分支在真实使用中只会走一次，走错一次就是整个活动期的打卡窗口不对。
 * 所以逐条钉住。
 */

const VALID: CampaignConfig = {
  ...CAMPAIGN_CONFIG,
  startDate: '2026-10-01',
  endDate: '2026-10-07',
}

describe('活动配置', () => {
  it('仓库里的默认配置必须先填日期才能用', () => {
    // 这是刻意的：留空意味着「还没人确认过」。给一个看起来合理的
    // 默认日期（比如国庆那几天）危险得多 —— 没人会注意到它没被确认，
    // 而活动窗口错了会让所有人的打卡被判成「不在活动期内」。
    expect(() => validateCampaignConfig()).toThrow(/还没填完：startDate、endDate/)
  })

  it('日期填好之后通过校验', () => {
    expect(() => validateCampaignConfig(VALID)).not.toThrow()
  })

  it('拒绝非 YYYY-MM-DD 的日期', () => {
    expect(() => validateCampaignConfig({ ...VALID, startDate: '2026/10/01' })).toThrow(
      /必须是 YYYY-MM-DD/,
    )
  })

  it('拒绝开始晚于结束', () => {
    expect(() =>
      validateCampaignConfig({ ...VALID, startDate: '2026-10-08', endDate: '2026-10-07' }),
    ).toThrow(/开始日期不能晚于结束日期/)
  })

  it('允许只有一天的活动', () => {
    expect(() =>
      validateCampaignConfig({ ...VALID, startDate: '2026-10-01', endDate: '2026-10-01' }),
    ).not.toThrow()
  })

  it('拒绝最少张数大于最多张数', () => {
    // 这种配置会让任何一次提交都失败，且报错信息是「图片数量不符」
    // 而不是「配置写错了」
    expect(() => validateCampaignConfig({ ...VALID, minImages: 3, maxImages: 1 })).toThrow(
      /最少图片数不能大于最多图片数/,
    )
  })

  it('三个赛道都有规则 —— 缺一个会导致那个赛道没分', () => {
    expect(Object.keys(CAMPAIGN_CONFIG.tracks).sort()).toEqual(['fitness', 'reading', 'vocabulary'])
  })

  it('毫点与权重都是整数', () => {
    // 后端刻意用整数存分值与权重，浮点尾差会让「同分并列」的判定
    // 在两次计算之间漂移（§9.3）
    for (const rule of Object.values(CAMPAIGN_CONFIG.tracks)) {
      expect(Number.isInteger(rule.dailyPoints)).toBe(true)
      expect(Number.isInteger(rule.overallWeight)).toBe(true)
      expect(rule.dailyCap === null || Number.isInteger(rule.dailyCap)).toBe(true)
      expect(rule.campaignCap === null || Number.isInteger(rule.campaignCap)).toBe(true)
    }
  })
})

describe('字段对照', () => {
  it('没有变化时不报变更', () => {
    const fields = applyableFields(VALID)
    expect(diffFields(fields, applyableFields(VALID))).toEqual([])
  })

  it('报出真正改变了的字段', () => {
    const before = applyableFields(VALID)
    const after = applyableFields({ ...VALID, dailyDeadline: '22:00' })
    expect(diffFields(before, after)).toEqual([
      { field: 'daily_deadline', from: '23:59', to: '22:00' },
    ])
  })

  it('数组按内容比较，不是按引用', () => {
    // 允许的 MIME 类型是个数组，每次读取都是新引用。
    // 用引用比较会把「没变」判成「变了」，于是每次部署都打印一堆假变更
    const before = applyableFields(VALID)
    const after = applyableFields({ ...VALID, allowedMimeTypes: [...VALID.allowedMimeTypes] })
    expect(diffFields(before, after)).toEqual([])
  })

  it('数组内容变了要报出来', () => {
    const before = applyableFields(VALID)
    const after = applyableFields({ ...VALID, allowedMimeTypes: ['image/png'] })
    expect(diffFields(before, after).map((change) => change.field)).toEqual(['allowed_mime_types'])
  })
})
