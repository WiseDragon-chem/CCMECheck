# CCME 国庆打卡平台

北京大学化学与分子工程学院国庆打卡活动平台：三个赛道的每日打卡、证明材料上传、
人工审核、积分计算与排行榜。

产品与技术设计见 [design.md](design.md)。各端细节见 [server/README.md](server/README.md)
与 [frontend/README.md](frontend/README.md)。

---

## 快速开始

需要 Node ≥ 20。前后端是两个独立的包，各自 `npm install`。

### 本地开发

```bash
# ---- 后端（终端 1）----
cd server
cp .env.example .env          # 必须填 JWT_SECRET 与 FILE_SIGNING_SECRET，各 ≥ 32 字符
npm install
npm run prisma:generate
npm run prisma:migrate        # 建库
npm run seed                  # 超级管理员 + 审核员 + 三个赛道
npm run dev                   # http://localhost:3000

# ---- 前端（终端 2）----
cd frontend
npm install
npm run seed:dev              # 演示数据：活动、24 个参赛者、打卡与审核记录
npm run dev                   # http://localhost:5173
```

`seed:dev` 需要后端已在运行 —— 它走 HTTP 接口播种，同时会把活动与计分规则建好，
所以**本地开发不需要手动创建活动**。

### 演示账号

密码都在 `server/.env` 里（学号在 `SEED_*_STUDENT_ID`，可改）：

| 角色 | 学号 | 密码 |
| --- | --- | --- |
| 超级管理员 | `admin` | `SEED_ADMIN_PASSWORD` |
| 审核员 | `reviewer` | `SEED_REVIEWER_PASSWORD` |
| 参赛者 | `2026001` 等 | `SEED_PARTICIPANT_PASSWORD`，默认 `DevPassw0rd!` |

**前两项在 `.env.example` 里是空的**，而 `server/.env` 不入库 —— 全新克隆后
`npm run seed` 会随机生成密码并**只打印一次**。本地开发建议先把它们填好再跑种子。

审核员与超管登录后直接进管理后台；参赛者进主页面。

### 上线前必做

活动日期与计分规则**定义在代码里**（见下），部署时先编辑
[server/src/config/campaign.ts](server/src/config/campaign.ts) 的日期，再执行：

```bash
cd server
npm run campaign:init         # 幂等：创建活动或把库改成与代码一致，并打印改了什么
```

日期留空时该命令会拒绝执行 —— 这是刻意的，见文件里的说明。

---

## 功能在哪

### 参赛者端（手机优先）

| 功能 | 路由 | 代码 |
| --- | --- | --- |
| 激活账号 | `/activate` | [ActivatePage.tsx](frontend/src/features/auth/pages/ActivatePage.tsx) |
| 登录 / 修改密码 | `/login`、`/me` | [LoginPage.tsx](frontend/src/features/auth/pages/LoginPage.tsx) · [ProfilePage.tsx](frontend/src/features/auth/pages/ProfilePage.tsx) |
| 主页面（今日三赛道卡片） | `/home` | [HomePage.tsx](frontend/src/features/checkin/pages/HomePage.tsx) |
| 提交打卡（上传证明材料） | `/checkin/:track` | [SubmitPage.tsx](frontend/src/features/checkin/pages/SubmitPage.tsx) |
| 打卡记录与详情 | `/records`、`/records/:id` | [RecordsPage.tsx](frontend/src/features/checkin/pages/RecordsPage.tsx) · [RecordDetailPage.tsx](frontend/src/features/checkin/pages/RecordDetailPage.tsx) |
| 排行榜（分赛道 + 总榜） | `/leaderboard` | [LeaderboardPage.tsx](frontend/src/features/leaderboard/pages/LeaderboardPage.tsx) |

### 管理后台（桌面优先）

超管专属的页面在导航里对审核员不可见，路由上也挡着。

| 功能 | 路由 | 代码 | 权限 |
| --- | --- | --- | --- |
| 概览：统计、赛道提交率、任务状态 | `/admin` | [DashboardPage.tsx](frontend/src/features/admin/pages/DashboardPage.tsx) | 审核员 |
| 流水线审核（键盘流） | `/admin/review` | [ReviewPipelinePage.tsx](frontend/src/features/admin/pages/ReviewPipelinePage.tsx) | 审核员 |
| 名单管理（导入、激活码） | `/admin/participants` | [ParticipantsPage.tsx](frontend/src/features/admin/pages/ParticipantsPage.tsx) | 超管 |
| 异常处理（补录、撤销、榜单维护） | `/admin/ops` | [OpsPage.tsx](frontend/src/features/admin/pages/OpsPage.tsx) | 超管 |
| 审计日志 | `/admin/audit` | [AuditLogPage.tsx](frontend/src/features/admin/pages/AuditLogPage.tsx) | 超管 |

**审核页的键盘操作**：`J` / `K` 上一条下一条，`A` 通过，`R` 驳回（数字键选原因，
`Enter` 确认），`+` / `-` 缩放。弹窗打开或全屏看图时决策键自动停用。

**API 文档**：开发环境在 <http://localhost:3000/api/v1/docs>（生产不挂载）。

### 什么时候用什么

1. **活动开始前** —— 填好 `campaign.ts` 的日期 → `campaign:init` → 在名单页导入参赛名单 →
   把一次性弹出的激活码发给本人（下载 CSV 后逐个转发）。
2. **活动期间** —— 审核员在审核页逐条过材料；管理员在概览页看提交率与积压，
   有异常时用异常处理页补录、重开、撤销或积分调整。
3. **活动结束后** —— 先清空待审队列，再在异常处理页**冻结最终榜单**，
   然后导出名册（名单页）。打卡明细与排行榜的导出接口后端已就绪，
   界面尚未做，暂时需要直接调接口（见下方 API 文档）。

---

## 常用命令

| 位置 | 命令 | 作用 |
| --- | --- | --- |
| server | `npm run dev` | 开发服务（HTTP 与定时任务同进程） |
| server | `npm run seed` | 管理员、审核员、三个赛道 |
| server | `npm run campaign:init` | 把代码里的活动配置同步到库 |
| server | `npm test` | 单元 + 验收测试 |
| server | `npm run prisma:studio` | 查看数据库 |
| frontend | `npm run dev` | 开发服务（`/api` 代理到 3000） |
| frontend | `npm run seed:dev` | 重播演示数据 |
| frontend | `npm run seed:dev -- --scenario-only --scenario closed` | 只换场景：`day` / `before` / `closed` / `settling` |
| frontend | `npm test` | 单元测试 |
| frontend | `npm run e2e` | 端到端测试（自起前后端与独立数据库，不碰开发环境） |
| frontend | `npm run gen:api` | 重新生成 `src/types/api.d.ts`（需要后端在跑） |

---

## 三条必须先知道的约定

**计分规则与活动日期写在代码里，没有后台配置界面。**
唯一来源是 [server/src/config/campaign.ts](server/src/config/campaign.ts)，改完跑
`npm run campaign:init` 应用。代价是改任何一项（含活动中途延期）都要一次部署 ——
这是知情的取舍，理由见该文件顶部与 design.md §8.4。

**激活码与临时密码的明文只出现一次。**
服务端只存哈希，之后只能重新生成（会使旧码作废）。界面会在生成时弹出一次性列表，
可复制或下载 CSV；错过了就只能在名单页重新生成。导出的「激活状态」给的是状态
（无 / 未使用 / 已使用 / 已过期），不是码。

**时间一律按北京时间。**
活动日、截止时间、倒计时都以服务端返回的服务器时间为准，设备时钟不可信。
`YYYY-MM-DD` 形式的日期在前后端都当字符串处理，不交给 `new Date()` 解析
（前端有一条 ESLint 规则专门挡这件事）。
