# CCME 国庆打卡平台 — 前端

参赛者与管理员界面。技术栈按 `design.md` §10.1：React + Vite + React Router + TanStack Query，
组件库为 Ant Design v5。

后端在 [`../server`](../server)，契约见其 README 与 `/api/v1/openapi.json`。

**当前进度**：工程骨架与参赛者端。管理后台在下一阶段，`/admin` 路由已留好位置。

---

## 快速开始

需要两个终端。**必须按这个顺序**，否则前端打开就是「当前没有进行中的活动」。

```bash
# 终端 1 —— 后端
cd server
npm install
npm run prisma:generate
npm run prisma:migrate
npm run seed          # 建超管与三个赛道
npm run dev           # http://localhost:3000

# 终端 2 —— 前端
cd frontend
npm install
npm run seed:dev      # 播种一个可用的活动、24 名参赛者与全部状态的打卡记录
npm run dev           # http://localhost:5173
```

`npm run seed:dev` 结束后会打印可直接登录的账号与密码。

### 为什么需要 `seed:dev`

后端的 `npm run seed` 只建超管与三个赛道，**不建活动**。
于是 `resolveCurrentCampaign` 会对所有参赛者接口返回 `CAMPAIGN_NOT_ACTIVE` ——
全新拉下来的项目，前端每个页面都是空的。`seed:dev` 补上这一块。

它通过**真实 HTTP 接口**播种，而不是直接写库。这样图片字节、EXIF 剥离、版本号、
审计行、快照幂等这些不变量全部天然正确，脚本本身也顺带成了一次端到端冒烟。

---

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器（5173，`/api` 代理到 3000） |
| `npm run build` | 类型检查 + 生产构建 |
| `npm run typecheck` | 仅类型检查 |
| `npm run lint` | ESLint |
| `npm test` | Vitest |
| `npm run e2e` | Playwright |
| `npm run gen:api` | 从后端 OpenAPI 生成 `src/types/api.d.ts` |
| `npm run seed:dev` | 播种开发数据 |

### 切换卡片状态

`design.md` §7.3 的状态由活动窗口决定，三个赛道凑不齐全部状态，
所以用场景开关改活动窗口来复现：

```bash
npm run seed:dev -- --scenario-only --scenario day        # 今日混合状态
npm run seed:dev -- --scenario-only --scenario before     # 全部「尚未开放」
npm run seed:dev -- --scenario-only --scenario closed     # 全部已截止
npm run seed:dev -- --scenario-only --scenario settling   # 活动停止提交
```

`--scenario-only` 只改活动配置，不重播数据，秒级生效。

**重播数据**（脚本不保证对已有数据可重复执行）：

```bash
cd ../server && rm prisma/dev.db* && npm run prisma:migrate && npm run seed && npm run dev
```

### 关于历史日期的数据

`seed:dev` 里，**今天**的记录走真实提交接口；**过去几天**走的是补录接口。

这不是取巧：每日截止一旦过去，正常提交接口本就该拒绝（`design.md` §16.5）。
补录接口正是为此存在的，所以历史数据带着 `is_manual` 标记是事实的忠实反映。

---

## 部署约束（重要）

**前端与 API 必须在同一注册域下**，由反向代理把 `/api` 转到后端。

刷新令牌是 `SameSite=Lax` 的 HttpOnly Cookie。若前端与 API 落在不同的*站点*
（例如 `app.example.com` → `api.example.com` 是可以的，但 `app.vercel.app` → `api.example.com` 不行），
浏览器不会在 XHR 上发送该 Cookie，**静默刷新会永久失败**，表现为「登录后一刷新就掉线」。

开发环境由 Vite 代理保证同源；生产环境需要反向代理做同样的事。
详见 `vite.config.ts` 里 `server.proxy` 的注释。

---

## 目录结构

```
src/
├── api/          HTTP 客户端、拦截器、错误映射、query key、生成的类型
├── components/   跨 feature 的通用组件
├── config/       环境变量等
├── features/     按业务域划分，页面放在各自的 feature 内
│   ├── auth/
│   ├── checkin/
│   ├── leaderboard/
│   └── admin/    管理后台五页（概览/审核/名单/异常处理/审计）
├── hooks/
├── layouts/
├── lib/          日期、毫点、幂等键等纯函数
├── locales/      全部面向用户的文案（zh-CN.ts 是唯一入口）
├── routes/
├── stores/
├── styles/
└── types/        api.d.ts（生成，勿手改）
```

**相对 `design.md` §10.1 的两处偏离**：

- 去掉顶层 `pages/`，页面放进各自的 feature。§10.1 同时给了 `features/` 和 `pages/`
  却没规定谁放什么，两个家必然导致漂移。
- 增加 `lib/` 与 `locales/`。毫点换算、活动日格式化、幂等键会被 4 个以上 feature 用到；
  不抽出来就会各写一遍，而那正是「积分差 1000 倍」「10-01 显示成 09-30」这类事故的来源。

---

## 关于 lint 与文案

**ESLint 只开能挡住真实缺陷的规则**，不追求条数。其中最重要的一条是禁止把
`YYYY-MM-DD` 交给 `new Date()` —— 它按 UTC 解析，在西半球时区会显示成前一天，
而且不报任何错。这条规则是那个 bug 唯一靠得住的守门人，因为单测跑在哪个时区
是随机的，抓不稳。

局限：它只能匹配字面量，`new Date(someVar)` 抓不到（那需要类型信息，
引入类型感知 lint 的成本大于收益）。字面量恰恰是最常见的写法。

**文案集中在 `src/locales/zh-CN.ts`**，组件里不写中文字面量。
理由是让文案能被单独审阅 —— 组织者想核对「用户到底看到哪些字」时只看一个文件，
不必翻十几个组件。术语沿用 design.md 的原词（打卡而非签到、驳回而非拒绝），
组织者在微信群推文里用的就是这套词。

组件里剩下的中文只有注释、标点分隔符和图标 emoji。

## 实现时容易踩的坑

1. **`YYYY-MM-DD` 当字符串处理，绝不 `new Date()`。** JS 规范里 date-only 按 UTC 午夜解析，
   `new Date('2026-10-01')` 在 +08:00 会渲染成 `09-30`。
2. **时间戳一律按 +08:00 展示**，不管浏览器在哪个时区。
3. **积分是整数毫点**（1000 = 1 分），只做展示不做运算。
4. **访问令牌不进 `localStorage`**，只在内存；刷新页面靠开机 `refresh` 恢复。
5. **并发 401 必须单飞刷新**，且 `TOKEN_INVALID` 不能重试（刷新也拿不到有效令牌）。
6. **上传进度需要 XHR**，`fetch` 拿不到 `upload.onprogress`。
7. **`client_token` 每次提交动作重新生成** —— 固定值会让第二次提交被当成重复而静默返回旧版本。
8. **签名图片地址会过期**（10 分钟），长时间停留的页面需要重签；不要改写它的 host。
9. **排行榜名次可能重复**（同分并列是 `design.md` §9.3 的预期行为），列表别按索引编号。
10. **姓名已由后端脱敏**，前端不要再脱敏一次。
