import { useNavigate } from 'react-router'
import { Button, Result } from 'antd'
import { paths } from '@/routes/paths'

export default function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <div className="centered-page">
      <Result
        status="404"
        title="页面不存在"
        subTitle="链接可能已经失效，或者地址输错了。"
        extra={
          <Button type="primary" onClick={() => navigate(paths.home)}>
            回到首页
          </Button>
        }
      />
    </div>
  )
}
