import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SIGNED_URL_TTL_SECONDS } from '../../src/config/constants.js'
import { randomObjectKey } from '../../src/core/crypto.js'
import { getPrismaClient } from '../../src/db/client.js'
import { signAssetUrl } from '../../src/storage/signed-url.js'
import { getStorage } from '../../src/storage/index.js'
import { api, authed, login } from '../helpers/app.js'
import {
  bootstrapCampaign,
  createEntry,
  createParticipant,
  createUser,
  makeImage,
  TEST_PASSWORD,
} from '../helpers/factory.js'

/**
 * design.md §16.11 参赛者无法读取他人的证明图片。
 * design.md §13：参赛者只能访问自己的材料，管理员按角色访问全部材料；
 *                图片访问使用短期签名地址。
 *
 * 这里有两层权限，必须分别验证：
 *   1. 签发端点（带会话）—— 谁能拿到签名地址；
 *   2. 取字节端点（无会话）—— 签名本身就是能力凭证，所以它必须真的只认签名：
 *      改动任何一个被签名字段都要失败。
 */

const SIGNING_PATH = (entryId: string, assetId: string) => `/api/v1/checkins/${entryId}/assets/${assetId}`

interface Seeded {
  entryId: string
  assetId: string
}

describe('§16.11 证明材料访问授权', () => {
  const db = getPrismaClient()

  let tokenA: string
  let reviewerToken: string
  let adminToken: string
  let userIdA: string
  let userIdAdmin: string
  let entryA: Seeded
  let entryB: Seeded
  let jpeg: Buffer

  beforeEach(async () => {
    const { campaign, tracks } = await bootstrapCampaign({ startDate: '2026-10-01', endDate: '2026-10-07' })
    const readingTrackId = tracks.find((track) => track.slug === 'reading')!.id

    const userA = await createUser({ studentId: '2026001', name: '张三' })
    const participantA = await createParticipant({ campaignId: campaign.id, userId: userA.id, className: '化学院一班' })
    userIdA = userA.id

    const userB = await createUser({ studentId: '2026002', name: '李四' })
    const participantB = await createParticipant({ campaignId: campaign.id, userId: userB.id, className: '化学院二班' })

    await createUser({ studentId: 'reviewer1', name: '审核员', role: 'reviewer' })
    const admin = await createUser({ studentId: 'admin1', name: '超级管理员', role: 'super_admin' })
    userIdAdmin = admin.id

    tokenA = (await login('2026001', TEST_PASSWORD)).accessToken
    reviewerToken = (await login('reviewer1', TEST_PASSWORD)).accessToken
    adminToken = (await login('admin1', TEST_PASSWORD)).accessToken

    jpeg = await makeImage('jpeg', { width: 64, height: 64 })

    const createdA = await createEntry({
      campaignId: campaign.id,
      participantId: participantA.id,
      trackId: readingTrackId,
      activityDate: '2026-10-01',
      withAsset: true,
    })
    const createdB = await createEntry({
      campaignId: campaign.id,
      participantId: participantB.id,
      trackId: readingTrackId,
      activityDate: '2026-10-01',
      withAsset: true,
    })

    entryA = { entryId: createdA.entry.id, assetId: createdA.asset!.id }
    entryB = { entryId: createdB.entry.id, assetId: createdB.asset!.id }

    await materialize(entryA.assetId)
    await materialize(entryB.assetId)
  })

  /**
   * createEntry 只摆数据库状态，不会写任何文件；而且它生成的 object_key 用的是
   * entry id 截断后的字符串，含非十六进制字符，会被 isValidObjectKey 挡下。
   * 「取字节」这条路径必须用真实的键和真实的字节，所以这里把素材补成一个
   * 真正上传过的样子。
   */
  async function materialize(assetId: string): Promise<void> {
    const objectKey = randomObjectKey()
    await getStorage().put(objectKey, jpeg)
    await db.submissionAsset.update({
      where: { id: assetId },
      data: { objectKey, mimeType: 'image/jpeg', size: jpeg.length, width: 64, height: 64 },
    })
  }

  /** 签名地址是绝对地址，取字节时要还原成 supertest 能用的路径 */
  function pathOf(url: string): string {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  }

  /**
   * 图片字节要用二进制解析：默认解析器遇到 image/* 不会给出 Buffer，
   * Buffer.compare 也就无从谈起。
   */
  function getBytes(path: string) {
    return api()
      .get(path)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => callback(null, Buffer.concat(chunks)))
      })
  }

  async function signAs(token: string, target: Seeded) {
    return authed(token).get(SIGNING_PATH(target.entryId, target.assetId))
  }

  async function expectSignatureInvalid(url: URL, label: string) {
    const response = await api().get(pathOf(url.toString()))
    expect(response.status, `${label}: ${JSON.stringify(response.body)}`).toBe(401)
    expect(response.body.code, label).toBe('SIGNATURE_INVALID')
  }

  // -------------------------------------------------------------------------
  // 签发端点的授权
  // -------------------------------------------------------------------------

  it('参赛者不能读取他人的证明材料', async () => {
    const response = await signAs(tokenA, entryB)

    expect(response.status, JSON.stringify(response.body)).toBe(403)
    expect(response.body.code).toBe('NOT_ENTRY_OWNER')
  })

  it('参赛者可以为自己的材料申请签名地址', async () => {
    const response = await signAs(tokenA, entryA)

    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body.expires_in).toBe(SIGNED_URL_TTL_SECONDS)
    expect(Date.parse(response.body.expires_at as string)).toBeGreaterThan(Date.now())

    const url = new URL(response.body.url as string)
    expect(url.pathname).toBe(`/api/v1/assets/${entryA.assetId}`)
    // 签名绑定的使用者就是申请者本人
    expect(url.searchParams.get('uid')).toBe(userIdA)
    expect(url.searchParams.get('sig')).toBeTruthy()
  })

  it('审核员与超级管理员可以读取任意参赛者的材料（§13 管理员访问全部材料）', async () => {
    for (const [label, token, userId] of [
      ['审核员', reviewerToken, null],
      ['超级管理员', adminToken, userIdAdmin],
    ] as const) {
      const response = await signAs(token, entryB)
      expect(response.status, `${label}: ${JSON.stringify(response.body)}`).toBe(200)

      const url = new URL(response.body.url as string)
      expect(url.pathname, label).toBe(`/api/v1/assets/${entryB.assetId}`)
      // 签发记录里的 uid 是「谁申请的」，用于审计追溯
      if (userId) expect(url.searchParams.get('uid'), label).toBe(userId)
    }
  })

  it('素材必须属于 URL 里的那个 entry', async () => {
    // 用自己的 entryId 拼上别人的 assetId，落不到同一条 revision 上
    const response = await authed(tokenA).get(SIGNING_PATH(entryA.entryId, entryB.assetId))

    expect(response.status, JSON.stringify(response.body)).toBe(404)
    expect(await db.submissionAsset.count()).toBe(2)
  })

  it('未登录不能申请签名地址', async () => {
    const response = await api().get(SIGNING_PATH(entryA.entryId, entryA.assetId))

    expect(response.status, JSON.stringify(response.body)).toBe(401)
    expect(response.body.code).toBe('UNAUTHENTICATED')
  })

  // -------------------------------------------------------------------------
  // 取字节端点：无会话，纯靠签名
  // -------------------------------------------------------------------------

  it('签名地址无需任何会话即可取回图片字节', async () => {
    const signed = await signAs(tokenA, entryA)
    const response = await getBytes(pathOf(signed.body.url as string))

    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.headers['content-type']).toBe('image/jpeg')
    expect(response.headers['content-length']).toBe(String(jpeg.length))
    expect(Buffer.compare(response.body as Buffer, jpeg)).toBe(0)
  })

  it('管理员申请的地址同样可以直接取字节', async () => {
    const signed = await signAs(adminToken, entryB)
    const response = await getBytes(pathOf(signed.body.url as string))

    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(Buffer.compare(response.body as Buffer, jpeg)).toBe(0)
  })

  it('篡改 sig / exp / 删掉 sig 一律被签名校验拦下', async () => {
    const signed = await signAs(tokenA, entryA)
    const original = new URL(signed.body.url as string)

    const tamperedSig = new URL(original)
    tamperedSig.searchParams.set('sig', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    await expectSignatureInvalid(tamperedSig, '篡改 sig')

    // 只改 exp、签名保持原样：签名覆盖了 exp，改动必然对不上
    const pastExp = new URL(original)
    pastExp.searchParams.set('exp', '1000000000')
    await expectSignatureInvalid(pastExp, '篡改 exp')

    const noSig = new URL(original)
    noSig.searchParams.delete('sig')
    await expectSignatureInvalid(noSig, '缺少 sig')

    const noUid = new URL(original)
    noUid.searchParams.delete('uid')
    await expectSignatureInvalid(noUid, '缺少 uid')
  })

  it('签名绑定 asset_id：拿自己的签名去请求别人的图片会被拒', async () => {
    // 先给一张真实存在的图片签名
    const signed = signAssetUrl({ assetId: entryA.assetId, userId: userIdA })
    const forged = new URL(signed.url)
    forged.pathname = `/api/v1/assets/${entryB.assetId}`

    await expectSignatureInvalid(forged, '换成别人的 asset_id')
  })

  it('签名有效但图片不存在时返回 404', async () => {
    // 签名只覆盖 asset_id 的取值，并不知道它是否真实存在，
    // 因此伪造一个 id 可以穿过签名校验，最终由数据库查询给出 404
    const signed = signAssetUrl({ assetId: 'clnonexistentassetid000000', userId: userIdA })
    const response = await api().get(pathOf(signed.url))

    expect(response.status, JSON.stringify(response.body)).toBe(404)
    expect(response.body.code).toBe('NOT_FOUND')
  })

  it('签名覆盖的是 asset_id 本身，不校验归属 —— 越权被拦在签发端点上', async () => {
    // 自己给自己签一个「别人的 asset_id」：签名算得出来，取字节也会成功。
    // 这是刻意接受的设计取舍（§13：签名地址本身就是能力凭证），
    // 它成立的唯一前提是「签发端点必须校验身份」—— 也就是上面那条 403 用例。
    // 两条用例必须成对存在，少任何一条都会让这个模型说不通。
    const forged = signAssetUrl({ assetId: entryB.assetId, userId: userIdA })
    const response = await getBytes(pathOf(forged.url))

    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(Buffer.compare(response.body as Buffer, jpeg)).toBe(0)

    // 但签发端点拦得住：参赛者拿不到这个地址，除非有人（管理员）签发给他
    expect((await signAs(tokenA, entryB)).status).toBe(403)
  })

  it('取字节端点不做会话校验，只认签名（设计取舍的显式记录）', async () => {
    // 签名地址本身就是凭证：谁拿到都能在有效期内访问。
    // 越权风险由「签发前校验身份」和「TTL 只有 10 分钟」承担，
    // 因此这里连 Cookie / Bearer 都不带也能取到字节 —— 与 <img src> 的用法一致。
    const signed = await signAs(adminToken, entryB)
    const response = await getBytes(pathOf(signed.body.url as string))

    expect(response.status).toBe(200)
    // 私有缓存：允许浏览器复用，但不进共享缓存
    expect(response.headers['cache-control']).toContain('private')
  })
})
