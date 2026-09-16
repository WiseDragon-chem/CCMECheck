import { useNavigate } from 'react-router'
import { Button, Result } from 'antd'
import { zh } from '@/locales/zh-CN'
import { paths } from '@/routes/paths'

export default function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <div className="centered-page">
      <Result
        status="404"
        title={zh.error.notFoundTitle}
        subTitle={zh.error.notFoundSubtitle}
        extra={
          <Button type="primary" onClick={() => navigate(paths.home)}>
            {zh.common.backHome}
          </Button>
        }
      />
    </div>
  )
}
