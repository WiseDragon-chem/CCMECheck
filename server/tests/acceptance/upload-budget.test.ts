import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_MAX_IMAGE_BYTES, DEFAULT_MAX_IMAGES } from '../../src/config/constants.js'
import { UPLOAD_MULTIPART_OVERHEAD_BYTES, uploadBudgetBytes } from '../../src/middleware/upload.js'
import { authed, login } from '../helpers/app.js'
import { bootstrapCampaign, createParticipant, createUser, makeImage, TEST_PASSWORD } from '../helpers/factory.js'
import { cst, freezeTimeAt, unfreezeTime } from '../helpers/time.js'
import { getPrismaClient } from '../../src/db/client.js'

/**
 * 上传的内存预算闸（middleware/upload.ts）。
 *
 * multer 用 memoryStorage 且全局硬上限是 9 × 50MiB —— 活动级限额（默认 3 × 640KB）
 * 若只在解码之后校验，恶意/失误的请求可以先让进程缓冲 450MiB。
 * 这里守住的是：超预算的请求在**读取请求体之前**就被拒。
 */
describe('上传预算闸', () => {
  const db = getPrismaClient()
  const ACTIVITY_DATE = '2026-10-01'
  const MAX_IMAGE_BYTES = 1024 * 1024

  let token: string
  let jpeg: Buffer

  beforeEach(async () => {
    freezeTimeAt(cst(`${ACTIVITY_DATE}T10:00:00`))

    const { campaign } = await bootstrapCampaign({
      startDate: '2026-10-01',
      endDate: '2026-10-07',
      maxImages: 3,
      maxImageBytes: MAX_IMAGE_BYTES,
    })
    const user = await createUser({ studentId: '2026100', name: '上传测试' })
    await createParticipant({ campaignId: campaign.id, userId: user.id })

    token = (await login('2026100', TEST_PASSWORD)).accessToken
    jpeg = await makeImage('jpeg')
  })

  afterEach(() => {
    unfreezeTime()
  })

  it('预算 = 张数 × 单张上限 + multipart 余量', () => {
    expect(uploadBudgetBytes({ maxImages: 3, maxImageBytes: 1024 })).toBe(3 * 1024 + UPLOAD_MULTIPART_OVERHEAD_BYTES)
  })

  it('超出活动限额的请求被预算闸拦下，并且调用方能读到这句提示', async () => {
    // 活动限额是 3 × 1MiB + 余量 ≈ 3.06MiB；这里送 4MiB。
    // multer 的全局硬上限（9 × 50MiB）不会拦它，只有预算闸能拦。
    //
    // 请求体刻意大于 socket 缓冲：服务端若在调用方还在上传时就关闭连接，
    // TCP 的 RST 会把已经写好的错误响应一起丢掉，这个用例会以 ECONNRESET 失败 ——
    // 也就是说它同时守着「闸门生效」和「错误提示真的送得到」两件事。
    const oversized = Buffer.alloc(4 * 1024 * 1024, 1)

    const response = await authed(token)
      .post('/api/v1/checkins')
      .field('track', 'reading')
      .field('activity_date', ACTIVITY_DATE)
      .attach('images', oversized, 'huge.jpg')

    expect(response.status, JSON.stringify(response.body)).toBe(400)
    expect(response.body.code).toBe('UPLOAD_INVALID')
    // 带上真实限额，前端才能给出可操作提示
    expect(response.body.details.limit_bytes).toBe(
      uploadBudgetBytes({ maxImages: 3, maxImageBytes: MAX_IMAGE_BYTES }),
    )
    expect(response.body.message).toContain('3 张')
    // 没有 multer_code 说明不是 multer 读完之后才报的错，而是闸门先拦下的
    expect(response.body.details.multer_code).toBeUndefined()

    // 被拒的请求不留下任何记录
    expect(await db.checkinEntry.count()).toBe(0)
  })

  it('限额之内的正常上传不受影响', async () => {
    const response = await authed(token)
      .post('/api/v1/checkins')
      .field('track', 'reading')
      .field('activity_date', ACTIVITY_DATE)
      .attach('images', jpeg, 'proof.jpg')

    expect(response.status, JSON.stringify(response.body)).toBe(201)
  })

  it('没有活动时回落到默认限额，不抢业务层的判断', async () => {
    await db.campaign.deleteMany()

    /*
      请求体取回退预算的一半 —— 刻意由常量算出来，而不是写死一个数字：
      这个用例要守的是「落在回退预算内的请求，闸门必须放行」，与默认限额
      具体是多少无关。写死数字的话，默认值一改它就会以「闸门拦住了」的
      形式失败，而失败原因看起来像是闸门坏了。
    */
    const withinFallback = Math.floor(
      uploadBudgetBytes({
        maxImages: DEFAULT_MAX_IMAGES,
        maxImageBytes: DEFAULT_MAX_IMAGE_BYTES,
      }) / 2,
    )

    // 闸门放行之后，由 submitCheckin 给出「当前没有进行中的活动」——
    // 错误语义不能从业务层搬到中间件
    const response = await authed(token)
      .post('/api/v1/checkins')
      .field('track', 'reading')
      .field('activity_date', ACTIVITY_DATE)
      .attach('images', Buffer.alloc(withinFallback, 1), 'huge.jpg')

    expect(response.status, JSON.stringify(response.body)).toBe(409)
    expect(response.body.code).toBe('CAMPAIGN_NOT_ACTIVE')
  })

  it('§7.4 打卡提交有限流，且限制的是成功提交在内的重复上传', async () => {
    // 限流器挂在 multer 之前，因此即使请求最终失败也会计数 —— 这里用不存在的赛道
    // 让每次请求都快速失败，避免 30 次真实上传把用例拖慢
    const statuses: number[] = []
    for (let attempt = 0; attempt < 31; attempt += 1) {
      const response = await authed(token)
        .post('/api/v1/checkins')
        .field('track', 'no-such-track')
        .field('activity_date', ACTIVITY_DATE)
        .attach('images', jpeg, 'proof.jpg')
      statuses.push(response.status)
    }

    expect(statuses.filter((status) => status === 429)).toHaveLength(1)
    expect(statuses[statuses.length - 1]).toBe(429)
  })
})
