import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * 扁平配置。
 *
 * 规则集刻意保持精简：只有**能挡住真实缺陷**的规则才开，
 * 不追求规则条数。下面那条禁止 `new Date('YYYY-MM-DD')` 的规则是主要目的 ——
 * 它是那个日期错位 bug 唯一靠得住的守门人（见 src/lib/datetime.ts 的说明）。
 */
export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'playwright-report', 'test-results', 'src/generated'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // 未使用的变量交给 TS 报（noUnusedLocals），这里只兜住参数
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

      'no-restricted-syntax': [
        'error',
        {
          /**
           * 禁止把 `YYYY-MM-DD` 形式的字符串交给 Date 解析。
           *
           * JS 规范里 date-only 形式按 **UTC 午夜**解析：`new Date('2026-10-01')`
           * 在 UTC+8 下是 10-01 08:00，但在 UTC-7 下是 09-30 17:00 ——
           * 同一份数据在不同用户的设备上显示成不同的日期，而且不会报任何错。
           *
           * 活动日是文本（后端刻意如此，让字典序等于时间序），
           * 前端必须原样当字符串处理，用 src/lib/datetime.ts 里的函数。
           *
           * 局限：这条规则只能抓到字面量。`new Date(someVar)` 抓不到 ——
           * 那需要类型信息，而引入类型感知 lint 的成本大于收益。
           * 字面量恰恰是最常见的那种写法（复制粘贴一个日期）。
           */
          selector:
            "NewExpression[callee.name='Date'][arguments.0.type='Literal'][arguments.0.value=/^\\d{4}-\\d{2}-\\d{2}/]",
          message:
            '不要把 YYYY-MM-DD 交给 new Date()：它按 UTC 解析，会在西半球时区显示成前一天。请用 @/lib/datetime 里的函数。',
        },
        {
          /**
           * 只管**纯日期字面量**。
           *
           * `Date.parse('2026-10-01T13:25:00Z')` 是安全的（带时间与 Z），
           * 代码里大量在用，不能一并禁掉 —— 那会把这条规则变成噪音，
           * 然后所有人都会开始加 eslint-disable。
           * 危险的只有 `Date.parse('2026-10-01')` 这一种。
           */
          selector:
            "CallExpression[callee.object.name='Date'][callee.property.name='parse'][arguments.0.type='Literal'][arguments.0.value=/^\\d{4}-\\d{2}-\\d{2}$/]",
          message: 'date-only 字符串按 UTC 解析会差一天，请用 @/lib/datetime 里的 parseDateOnly。',
        },
      ],
    },
  },

  // 构建期脚本跑在 Node 里，不是浏览器
  {
    files: ['tools/**/*.mjs', 'e2e/**/*.ts', '*.config.{js,ts}'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // 名单导入的 CSV 必须带 BOM（Excel 否则把中文显示成乱码），
      // 而 BOM 就是一个不规则空白字符
      'no-irregular-whitespace': ['error', { skipTemplates: true, skipStrings: true }],
    },
  },
)
