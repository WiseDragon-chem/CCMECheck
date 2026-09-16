import { Suspense, useMemo, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import {
  AuditOutlined,
  DashboardOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SafetyOutlined,
  SwapOutlined,
  TeamOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import { Button, Layout, Menu, Space, Spin, Tag, Tooltip, Typography } from 'antd'
import { fetchCurrentCampaign } from '@/api/endpoints/campaign'
import { qk } from '@/api/queryKeys'
import { zh } from '@/locales/zh-CN'
import { paths } from '@/routes/paths'
import { useAuthStore } from '@/stores/auth.store'

/**
 * 管理后台布局：桌面优先。
 *
 * 与参赛者端**完全分开**：后台是三栏、表格与键盘操作，
 * 挤进 375px 或把参赛者流程塞进 1280px 的表格里，两边都会难用（§10.1）。
 *
 * 导航项按角色过滤，但这只是体验层 —— §5 明确写了前端隐藏入口不算权限控制，
 * 真正的边界在后端每个接口的守卫上。
 */
export default function AdminLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((state) => state.user)

  const campaignQuery = useQuery({
    queryKey: qk.campaign,
    queryFn: fetchCurrentCampaign,
    staleTime: Infinity,
  })

  const isSuperAdmin = user?.role === 'super_admin'

  const items = useMemo(
    () => [
      { key: paths.admin.dashboard, icon: <DashboardOutlined />, label: zh.admin.nav.dashboard },
      { key: paths.admin.review, icon: <UnorderedListOutlined />, label: zh.admin.nav.review },
      // 名单、异常操作与审计只有超管能做（§5），但后端才是真正的边界
      ...(isSuperAdmin
        ? [
            { key: paths.admin.participants, icon: <TeamOutlined />, label: zh.admin.nav.participants },
            { key: paths.admin.ops, icon: <SafetyOutlined />, label: zh.admin.nav.ops },
            { key: paths.admin.audit, icon: <AuditOutlined />, label: zh.admin.nav.audit },
          ]
        : []),
    ],
    [isSuperAdmin],
  )

  // 审核页有 /admin/review/:entryId 这样的子路径，选中态按键的前缀匹配
  const selectedKey = items.find((item) => location.pathname.startsWith(item.key))?.key

  const campaign = campaignQuery.data?.campaign

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider theme="light" collapsible collapsed={collapsed} trigger={null} width={220}>
        <div className="admin-sider__brand">
          <Typography.Text strong>{collapsed ? '打卡' : zh.app.name}</Typography.Text>
        </div>
        <Menu
          mode="inline"
          selectedKeys={selectedKey ? [selectedKey] : []}
          items={items}
          onClick={({ key }) => navigate(key)}
        />
      </Layout.Sider>

      <Layout>
        <Layout.Header className="admin-header">
          <Space size={12}>
            <Button
              type="text"
              aria-label={collapsed ? zh.admin.expandNav : zh.admin.collapseNav}
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((value) => !value)}
            />
            {campaign && (
              <>
                <Typography.Text strong>{campaign.name}</Typography.Text>
                <Tag color={campaign.status === 'active' ? 'green' : 'default'}>
                  {zh.admin.campaignStatus[campaign.status as keyof typeof zh.admin.campaignStatus] ??
                    campaign.status}
                </Tag>
              </>
            )}
          </Space>

          <Space size={12}>
            <Typography.Text type="secondary">{user?.name}</Typography.Text>
            {/*
              §5：审核员也可同时是参赛者。两套布局之间要能互相走通，
              否则既是审核员又是参赛的人无法给自己打卡。
            */}
            <Tooltip title={zh.admin.toParticipantView}>
              <Link to={paths.home}>
                <Button size="small" icon={<SwapOutlined />}>
                  {zh.admin.participantView}
                </Button>
              </Link>
            </Tooltip>
          </Space>
        </Layout.Header>

        <Layout.Content className="admin-content">
          {/* 懒加载的页面切换时给一个明确的等待态，避免空白让人以为卡住了 */}
          <Suspense
            fallback={
              <div className="admin-suspense">
                <Spin />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </Layout.Content>
      </Layout>
    </Layout>
  )
}
