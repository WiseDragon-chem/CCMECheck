import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/renderWithProviders'
import ProfilePage from './ProfilePage'

/**
 * 「我的」页的修改密码面板。
 *
 * 本页挂载时不发请求（用户信息取自 auth store），所以这里不需要 msw ——
 * 与其它页面用例不同，不必先 beforeAll(server.listen)。
 */
describe('我的页 · 修改密码', () => {
  it('默认折叠，展开后才出现三个输入框', async () => {
    renderWithProviders(<ProfilePage />, { route: '/me' })

    // 名字用正则而不是全等：antd 给表头的箭头图标写死了 aria-label="collapsed"，
    // 它会并进无障碍名称，于是实际是「collapsed 修改密码」。
    // 那个词不可见，其它两处 Collapse 也一样，属于全仓库共有的 antd 行为。
    const header = screen.getByRole('button', { name: /修改密码/ })

    // 折叠时表单**尚未挂载**，不是藏起来：rc-collapse 的 forceRender 默认为
    // false，面板内容首次展开才渲染。所以页面初始体积确实比改动前小。
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText('当前密码')).not.toBeInTheDocument()

    await userEvent.click(header)

    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByLabelText('当前密码')).toBeInTheDocument()
    expect(screen.getByLabelText('新密码')).toBeInTheDocument()
    expect(screen.getByLabelText('确认新密码')).toBeInTheDocument()
  })
})
