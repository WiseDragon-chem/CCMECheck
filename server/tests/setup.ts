// 必须排在最前：ESM 按导入顺序求值，环境变量要先于 src/ 模块生效
import './test-env.js'

import { afterAll, beforeEach } from 'vitest'
import { disconnectPrismaClient, getPrismaClient } from '../src/db/client.js'
import { truncateAllTables } from './helpers/db.js'

/**
 * 每个测试用例前清空所有表。
 *
 * 用「全表清空」而不是事务回滚：SQLite 单写入者，
 * 嵌套事务与 SQLITE_BUSY 重试会让回滚方案变得脆弱，
 * 而单个用例的数据量很小，全清的成本可以忽略。
 */
beforeEach(async () => {
  await truncateAllTables(getPrismaClient())
})

afterAll(async () => {
  await disconnectPrismaClient()
})
