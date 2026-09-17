# CCME 国庆打卡平台 — 后端

北京大学化学与分子工程学院国庆打卡活动的后端服务。支持读书、单词背诵、运动健身三个赛道的
每日打卡、证明材料上传、人工审核、积分计算与排行榜快照。

实现依据为仓库根目录的 [`design.md`](../design.md)（v0.2）。**本文档同时记录了实现过程中
对设计文档的每一处裁决**，见第 8 节 —— 那些地方设计文档没有写明或自相矛盾。

---

## 1. 技术栈与关键决策

| 项 | 选型 | 说明 |
| --- | --- | --- |
| 运行时 | Node.js 20+（开发于 v24） | |
| 语言 | TypeScript（ESM，`nodenext`） | 相对导入必须带 `.js` 后缀 |
| Web | Express 5 | 原生支持 async handler 的错误转发 |
| ORM | Prisma 7 + `@prisma/adapter-better-sqlite3` | |
| 数据库 | SQLite（WAL 模式） | 单进程部署，见下 |
| 校验 | Zod 4 | 请求校验与错误响应的单一来源 |
| 密码 | Argon2id（`@node-rs/argon2`） | N-API 预编译，Windows 下无需构建工具链 |
| 图片 | sharp | 解码校验、EXIF 剥离、尺寸读取 |
| 日志 | pino | 结构化 + 字段脱敏 |
| 定时任务 | node-cron（`Asia/Shanghai`） | |

**Prisma 版本必须锁死。** npm 上 `prisma` 的 `latest` tag 目前指向 `8.0.0-rc`，
不写版本号会装到 RC。`package.json` 里显式钉住了 `7.10.0`。

**SQLite 决定了单进程部署。** SQLite 同一时刻只允许一个写入者，因此 HTTP 服务与定时任务
调度器运行在同一个 Node 进程内；任务互斥通过数据库锁表实现。这也是设计文档 §10.2 的结论。

### 积分用整数，不用浮点

设计文档 §9.1 的 `total_score = Σ(track_score × overall_weight)` 如果直接用小数权重累加，
浮点尾差会让「同分并列」的判定在不同次计算之间抖动，名次随之漂移。

因此实现中：

- 积分一律是**整数毫点**（`1000` = 1 分）；
- 权重是**整数千分比**（`1000` = 1.0）；
- 加权求和时先累加 `score × weight`，最后**只做一次**四舍五入。

这是本次实现对设计文档唯一的实质性修正。

---

## 2. 快速开始

```bash
cd server
npm install

# 生成 Prisma Client
npm run prisma:generate

# 建库并应用迁移
npm run prisma:migrate

# 写入初始数据：超级管理员 + 审核员 + 三个赛道（不预置活动）
npm run seed

# 启动开发服务（HTTP + 定时任务同进程）
npm run dev
```

首次执行 `npm run seed` 时，如果 `.env` 里的 `SEED_ADMIN_PASSWORD` 为空，
脚本会随机生成一个管理员密码并**只打印一次**，请立即保存并登录后修改。

服务启动后：`http://localhost:3000/healthz` 可用于存活探测。

### 本地开发提示

- `.env` 从 `.env.example` 复制。`JWT_SECRET` 与 `FILE_SIGNING_SECRET` 至少 32 字符，
  启动时由 Zod 校验，不满足直接失败退出。
- 数据库文件放在普通本地磁盘上。**不要放在 OneDrive 等同步目录**，WAL 在同步文件系统上会失效。
- 活动不在种子里。本地开发由前端的 `npm run seed:dev` 通过接口创建；部署时用
  `npm run campaign:init`（需要先填 `src/config/campaign.ts` 的日期，留空会拒绝执行）。

---

## 3. npm 脚本

| 脚本 | 作用 |
| --- | --- |
| `npm run dev` | tsx watch 启动，含定时任务 |
| `npm run build` / `npm start` | 编译到 `dist/` 并运行 |
| `npm run typecheck` | 全量类型检查 |
| `npm run prisma:migrate` | 开发期迁移 |
| `npm run prisma:deploy` | 生产环境应用迁移 |
| `npm run seed` | 写入初始数据：管理员、审核员、三个赛道（幂等） |
| `npm run campaign:init` | 把 `src/config/campaign.ts` 里的活动与计分规则同步到库（幂等，会打印改了哪些字段） |
| `npm test` / `npm run test:watch` | Vitest |

---

## 4. 环境变量

见 [`.env.example`](./.env.example)。除常规项外，有两点值得注意：

- `STORAGE_ROOT` —— 证明材料与导入预览文件的私有根目录，默认为 `./storage`。
- `SCHEDULER_ENABLED` —— 设为 `false` 可关闭进程内定时任务，测试与本地调试用。
- `EVIDENCE_RETENTION_DAYS` —— 活动结束多少天后自动删除证明材料。**默认 0，即永不删除。**
  自动删除用户上传的材料不可逆，必须由组织者显式开启。对应 design.md §18.8 的遗留问题。

测试环境不读取 `.env`（`NODE_ENV=test` 时跳过），全部变量由 `tests/test-env.ts` 提供，
避免开发库的连接串覆盖测试库。

---

## 5. 目录结构

```
src/
├── index.ts            入口：初始化 db → 组装 app → listen → 启动调度器
├── app.ts              Express 装配（中间件顺序、路由挂载、错误处理）
├── routes.ts           /api/v1 路由表
├── config/             env（Zod 校验）、constants（状态与错误码目录）
├── core/               错误体系、北京时间算术、加密、路由包装、CSV 工具
├── db/                 PrismaClient（含 pragma）、事务与写锁重试
├── middleware/         request-id、鉴权、授权、限流、上传、错误处理
├── storage/            私有存储抽象、本机实现、HMAC 签名地址
├── services/           计分引擎、快照引擎、图片流水线、审计
├── jobs/               调度器、任务锁、执行外壳、四类任务定义
├── modules/<name>/     每个模块固定 routes / service / schema 三个文件
└── openapi/            OpenAPI 文档生成
```

约定：`routes.ts` 只做参数解析与响应，业务逻辑在 `service.ts`，
Zod schema 在 `schema.ts`（同时供 OpenAPI 注册）。

---

## 6. 接口

全部以 `/api/v1` 为前缀。响应体字段统一 `snake_case`，与设计文档 §12.5 的错误体一致。

### 6.1 认证

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/activate` | 学号 + 激活码激活账号 |
| POST | `/auth/login` | 登录 |
| POST | `/auth/refresh` | 刷新访问令牌（轮换刷新令牌） |
| POST | `/auth/logout` | 退出并撤销当前会话 |
| POST | `/auth/change-password` | 修改密码 |
| GET | `/users/me` | 当前用户 |

访问令牌为 JWT（`Authorization: Bearer`）；刷新令牌放在 `HttpOnly` Cookie 中，
`Path` 限定为 `/api/v1/auth`，刷新时轮换，旧的立即撤销。

### 6.2 活动与打卡

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/campaigns/current` | 当前活动、赛道规则、服务器时间 |
| GET | `/checkins/today` | 今日三个赛道的卡片状态 |
| GET | `/checkins` | 个人打卡记录（按赛道/状态/日期筛选） |
| GET | `/checkins/:entryId` | 打卡详情与历史版本 |
| POST | `/checkins` | 创建或重新提交（`multipart/form-data`） |
| GET | `/checkins/:entryId/assets/:assetId` | 签发短期图片地址 |
| GET | `/assets/:assetId?exp&uid&sig` | 凭签名取回图片字节 |

`POST /checkins` 的 multipart 字段：`track`、`activity_date`、`note?`、`client_token?`、`images`（1–3 张）。
`client_token` 是防重复点击的幂等键，同一 token 重复提交只会得到一个版本。

**图片字节端点刻意不做会话认证**：`<img src>` 无法携带 Bearer 令牌，
签名本身就是短期能力凭证（默认 10 分钟）。签发端点已校验请求者身份。

### 6.3 排行榜

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/leaderboards/latest?track=&limit=&offset=` | 最新快照的赛道榜或总榜 |
| GET | `/leaderboards/me?track=&neighbors=` | 我的排名与附近名次 |

`track` 省略时返回总榜。

### 6.4 管理后台

| 方法 | 路径 | 最低角色 | 说明 |
| --- | --- | --- | --- |
| GET | `/admin/dashboard` | reviewer | 首页统计与任务告警 |
| GET | `/admin/reviews/queue` | reviewer | 待审核队列与审核进度 |
| GET | `/admin/reviews/:entryId` | reviewer | 审核详情（含历史） |
| POST | `/admin/reviews/:entryId/approve` | reviewer | 审核通过 |
| POST | `/admin/reviews/:entryId/reject` | reviewer | 审核驳回（必填原因） |
| GET/PUT | `/admin/campaign` | super_admin | 活动配置读写 |
| POST | `/admin/campaign` | super_admin | 新建活动 |
| PUT | `/admin/campaign/tracks/:trackId` | super_admin | 赛道计分规则 |
| GET | `/admin/participants` | super_admin | 参赛者列表 |
| POST | `/admin/participants` | super_admin | 添加单个参赛者 |
| PATCH | `/admin/participants/:participantId` | super_admin | 启用/禁用 |
| POST | `/admin/participants/:participantId/activation-code` | super_admin | 重发激活码 |
| POST | `/admin/participants/:participantId/reset-password` | super_admin | 重置密码 |
| POST | `/admin/participants/:participantId/anonymize` | super_admin | 匿名化（不可逆） |
| GET | `/admin/participants/template.csv` | super_admin | 名单模板 |
| GET | `/admin/participants/activation-codes.csv` | super_admin | 激活码状态导出 |
| POST | `/admin/participants/import/preview` | super_admin | 校验并预览名单 |
| POST | `/admin/participants/import/commit` | super_admin | 正式导入 |
| POST | `/admin/checkins/:entryId/reopen` | super_admin | 临时重新开放 |
| POST | `/admin/checkins/:entryId/revoke` | super_admin | 撤销审核结果 |
| POST | `/admin/checkins/:entryId/void` | super_admin | 作废记录 |
| POST | `/admin/checkins/manual` | super_admin | 补录 |
| POST | `/admin/score-adjustments` | super_admin | 积分调整 |
| POST | `/admin/leaderboards/rebuild` | super_admin | 重算排行榜 |
| POST | `/admin/leaderboards/freeze` | super_admin | 冻结最终榜单 |
| POST | `/admin/leaderboards/unfreeze` | super_admin | 解冻 |
| GET | `/admin/exports/checkins.csv` | reviewer + `exports.run` | 打卡明细 |
| GET | `/admin/exports/leaderboard.csv` | reviewer + `exports.run` | 排行榜 |
| GET | `/admin/exports/participants.csv` | reviewer + `exports.run` | 参赛者名册 |
| GET | `/admin/reviews/reject-reasons` | reviewer | 预设驳回原因列表 |
| GET | `/admin/audit-logs` | super_admin | 审计日志 |
| GET | `/admin/jobs/scheduled` | super_admin | 已注册的调度计划 |
| GET | `/admin/jobs/runs` | super_admin | 任务执行历史 |
| POST | `/admin/jobs/:name/run` | super_admin | 手动触发任务 |

### 6.5 API 文档

| 路径 | 说明 |
| --- | --- |
| `GET /api/v1/openapi.json` | OpenAPI 3.1 文档 |
| `GET /api/v1/docs` | Swagger UI（仅非生产环境） |

请求体直接引用各模块运行时校验用的同一份 Zod schema，因此文档与实现不会各自漂移。

设计文档 §5 明确要求「后端必须在每个受保护接口中验证权限，前端隐藏入口不能充当权限控制手段」，
因此每个受保护路由都挂了守卫，`tests/acceptance/permissions.test.ts` 用一张
`{方法, 路径, 最低角色}` 表扫描全部管理接口，未来新增路由漏挂守卫也会被测出来。

### 6.6 错误响应

```json
{
  "code": "CHECKIN_CLOSED",
  "message": "该活动日的打卡已经截止",
  "request_id": "req_xxx",
  "details": {}
}
```

前端应依据稳定的 `code` 分支，不要依赖 `message` 文案（§12.5）。
完整错误码目录见 [`src/config/constants.ts`](./src/config/constants.ts) 的 `ERROR_STATUS`。

---

## 7. 关键机制

### 7.1 北京时间与活动日

服务器统一保存 UTC，同时为每条打卡记录保存 `activity_date`（`YYYY-MM-DD` 文本）。
ISO 文本的字典序与时间序一致，因此既能范围查询，也能让唯一约束按业务日期生效。

中国不实行夏令时，所有换算按固定 `+08:00` 做纯整数运算（见 `src/core/time.ts`），
**不依赖时区数据库，也不受服务器 `TZ` 环境变量影响**。测试套件在默认时区与
`TZ=America/Los_Angeles` 下各跑一遍来验证这一点。

### 7.2 打卡槽位与版本

一个槽位由 `(participant_id, track_id, activity_date)` 唯一确定。
重新提交产生新的 `submission_revisions` 版本并保留历史，槽位不变，状态恢复为 `pending`。

图片先写存储再写库：万一事务失败最多留下孤儿对象，由清理任务在宽限期后回收，
不会出现「有记录无文件」。

### 7.3 并发审核

设计文档给了「版本号或短期审核锁」两条路，实现选**版本号**：
锁在进程崩溃时会泄漏，而版本号比较是无状态的。

`checkin_entries.version` 每次状态流转自增；审核请求必须回传它看到的 `version`，
事务内比对不一致返回 `409 REVIEW_CONFLICT`。两名管理员同时操作时，恰好一人成功。

### 7.4 计分与快照

- 只有 `approved` 记录计分；`pending` / `rejected` / `revoked` / `void` 一律不计分。
- **人工调整不受活动上限约束** —— 否则管理员为特殊记录加分会被 `campaign_cap` 静默吃掉。
- 人工调整只新增 `score_adjustments` 行，**从不改写原始积分字段**（§9.1 的硬性要求）。
- 快照幂等由 `(campaign_id, cutoff_date)` 唯一约束 + 单事务内「先删后插」保证，重复执行只刷新同一份快照。
- 统计口径：`activity_date <= cutoff_date` 且生成时刻已通过审核的记录。
- 冻结后快照行永不被重写；冻结前会检查待审核队列是否已清空。

### 7.5 定时任务

| 频率 | 任务 |
| --- | --- |
| 每小时（整点） | 排行榜快照 —— 任务内部比对活动配置的排行榜时间 |
| 每小时（:17） | 清理失效会话与激活码 |
| 每日 03:33 | 清理孤儿上传 |
| 每日 04:47 | 数据库备份（`VACUUM INTO`） |
| 每日 05:23 | 按保留期清理证明材料（**默认不启用**） |
| 每 5 分钟 | 活动状态边界切换 |

快照任务没有写死 `0 6 * * *`，而是每小时触发后比对活动配置的排行榜时间 ——
排行榜时间可由管理员配置（§8.4），写死表达式会让改配置必须重启进程才生效。

每个任务统一经 `runJob` 执行，从而获得 `job_locks` 互斥与 `job_runs` 记录。
进程启动时会回收上次崩溃残留的 `running` 记录。

### 7.6 匿名化与材料保留

§8.3 要求「已有正式记录的参赛者不允许直接删除，可进行禁用或匿名化处理」——
不能删是因为记录要用于统计与审计，匿名化则是保留记录、去掉与人的关联。

`POST /admin/participants/:id/anonymize` 抹除：姓名与学号（换成随机占位符，
唯一约束仍成立）、姓名快照、班级、手机尾号、备注、全部登录会话与激活码。
**默认连证明材料一起删** —— 截图里常常带着姓名或账号，留着等于只做了一半。
争议未了结时可传 `delete_evidence: false` 保留。

保留的是打卡记录本体（日期、赛道、状态、积分）与审核行为，它们不含身份信息
且是榜单与审计所必需。匿名化后该参赛者不再出现在排行榜上。

材料的**保留期**由 `EVIDENCE_RETENTION_DAYS` 控制，默认不自动删除（§18.8）。
清理任务只删材料与备注，同样保留打卡记录。

两处都是不可逆操作，都写审计；且都**先删库、后删文件** ——
反过来一旦事务失败，库里会留下指向空文件的记录，界面上就是「有记录但图片全裂」。

### 7.7 安全

- 密码使用 Argon2id（19 MiB / 2 次迭代）；账号不存在时也做一次哈希校验，避免计时侧信道枚举学号。
- 激活码与刷新令牌只存 SHA-256 哈希，明文只在生成时返回一次。
- 对象键是随机标识，**不含姓名或学号**。
- 图片按内容识别格式，不信任扩展名与 `Content-Type`；解码后重新编码以剥离 EXIF（含地理位置）。
- 限制像素总量，防御解压炸弹。
- 日志脱敏覆盖请求头、请求体敏感字段，并剥离查询串中的签名参数 ——
  签名地址本身就是能力凭证，写进日志等于泄漏。

---

## 8. 对设计文档的裁决

实现过程中遇到设计文档未写明、自相矛盾或明显过度设计之处，处理如下。

### 8.1 必须补充的（否则某条明确需求无法满足）

| # | 问题 | 处理 |
| --- | --- | --- |
| 1 | §11.2 要求索引 `(status, submitted_at)`，但两列分属 `checkin_entries` 与 `submission_revisions`，跨表建不了索引 | 补 `checkin_entries.current_submitted_at`，每次插入版本时写入 |
| 2 | §8.4 要求配置每日开放时间、排行榜可见性、同分规则、图片限制，§11.1 的 `campaigns` 里没有对应字段 | 全部补齐 |
| 3 | §8.3 的名单操作、§8.4 的配置读写、§8.5 的撤销/作废/调分、§8.1 的首页统计、§8.2 的审核详情，在 §12.4 中**都没有端点** | 全部补上（见 6.4） |
| 4 | §12.2 给了「获取临时图片地址」的端点，但没有任何端点真正吐出图片字节 | 拆成「签发签名地址」与「凭签名取流」两个端点 |
| 5 | §8.5「临时重新开放」无时限机制，等于永久绕过 §16.5 | 补 `reopen_expires_at`，默认 120 分钟、上限 7 天 |
| 6 | §5 权限矩阵中审核员「按权限配置」的两格 | 用 `users.capabilities` 表示（`reviews.revoke`、`exports.run`） |
| 7 | §9.3 同分第 ③ 条「达到当前积分的时间」未定义 | 定义为计分记录按审核时间升序累加、首次达到最终积分的时刻 |
| 8 | §9.2 的 cutoff 公式只有文字描述 | `min(今天 - 1 天, 结束日)`，早于开始日则跳过 |
| 9 | §14「活动状态边界自动切换」没有状态迁移表 | `published→active`（今天 ≥ 开始日）、`active→settling`（今天 > 结束日），其余手工 |
| 10 | §7.1「确认后才正式写入」 | 预览时把原始 CSV 落盘，提交时**重新解析**，不信任客户端回传的结果 |

### 8.2 有歧义、按下列读法实现

| # | 问题 | 读法 |
| --- | --- | --- |
| 11 | §6.4 状态图未画 `pending → void`，但 §8.5 允许作废违规记录 | 超管可对任意状态作废（`void` 除外） |
| 12 | `checkin_entries.participant_id` 指向 `users.id` 还是 `campaign_participants.id` | 指向 `campaign_participants.id`，槽位约束因此天然按活动隔离，§1 的「可复用」才成立 |
| 13 | §16.15 与 §9.2「先清空待审核队列」的关系 | 冻结加硬性前置检查 `PENDING_REVIEWS_REMAIN` |
| 14 | 审核在哪些活动状态下允许 | `active` / `settling` 正常；`finished` / `archived` 下仅超管可带审计覆写 |
| 15 | §5「审核员可同时作为参赛者」与单 `role` 列的张力 | 保留单角色列（取最高权限），导入名单时给每个人建参赛者行 |
| 16 | §9.1 的积分上限与人工调整的交互 | **调整不受上限约束** |
| 17 | §9.1 的浮点积分 | 改为整数毫点 + 整数千分比权重 |
| 18 | `campaigns.timezone` 可配置，但整个设计假设北京时间 | v1 只接受 `Asia/Shanghai`，其它值写入时报错 |
| 19 | §7.2「修改密码后相关刷新令牌全部失效」 | 撤销改密**之前**存在的全部会话，同时为当前设备补发一套新凭证（用户刚证明过自己知道密码，不该被立刻踢下线） |
| 20 | §8.5「临时重新开放」重开后，参赛者成功提交 | 消费掉重开窗口并将 `reopen_expires_at` 置空，避免长期有效 |

### 8.3 按原样实现、但确属过度设计（记录备查）

- 本地私有目录之上再加 HMAC 签名地址 —— 保留，它是迁移到对象存储的接缝。
- 槽位唯一约束下 `daily_cap` 结构性冗余 —— 保留，管理员可能调整 `daily_points`。
- `leaderboard_snapshots` 的 `status` 与 `is_final` 近似重复 —— 保留。
- 六个活动状态中 `draft` 与 `archived` 实际不会用到 —— 保留。
- §13「敏感操作重新验证权限」实现为 5 分钟内的新鲜令牌而非重输密码 ——
  否则会打断 §8.2 键盘驱动的审核流水线。

### 8.4 仍待确认

§18 列出的活动日期、赛道证明要求、默认分值与权重、同分奖项分配、姓名脱敏规则、
激活码发放渠道、部署环境等，均需业务方确认后才能定稿配置。

其中**图片保留期限**已经从「代码缺口」变成了纯粹的配置决定：
机制已就绪（`EVIDENCE_RETENTION_DAYS` + 每日清理任务），
差的是组织者给出一个天数，以及决定是否开启。

---

## 9. 测试

```bash
npm test
```

覆盖设计文档 §16 的全部 16 条验收场景，另加计分引擎、北京时间算术、签名与图片流水线的单元测试。

```bash
# 验证「不受服务器时区影响」（§6.2）
TZ=America/Los_Angeles npm test
```

测试使用独立的 `prisma/test.db`，每次运行前重建并应用迁移；每个用例前清空全部表。

**注意：两个 vitest 进程不能同时运行**（包括在 IDE 里再开一个）。
它们共用同一个测试数据库文件，会互相清表，表现为莫名其妙的唯一约束冲突或登录失败。

---

## 10. 部署注意

- 生产流量强制 HTTPS；刷新令牌的 Cookie 只在 `NODE_ENV=production` 下带 `Secure`。
- 数据库每日由 `database_backup` 任务用 `VACUUM INTO` 生成一致性快照，输出到 `BACKUP_ROOT`，
  超过 `BACKUP_RETENTION_DAYS` 的自动清理。

  **不要用文件拷贝做备份**：WAL 模式下直接复制 `.db` 会漏掉还在 `-wal` 里的已提交事务，
  得到的备份可能缺数据。`VACUUM INTO` 由 SQLite 自己保证一致性。

  上线前应做一次实际的恢复演练（§15）：从备份文件启动一个实例，核对记录数与积分。
- 单进程部署。若确有横向扩展需求，SQLite 是瓶颈所在 —— 设计文档 §10.2 明确要求
  通过合并写入与延长读缓存缓解，而不是更换数据库。
- 迁移用 `npm run prisma:deploy`，不要在生产跑 `migrate dev`。
