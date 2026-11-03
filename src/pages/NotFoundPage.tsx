import { Link } from '../components/Link'

export function NotFoundPage() {
  return (
    <div className="wrap gate">
      <h1 className="page-title">없는 페이지예요</h1>
      <p className="page-sub">주소가 바뀌었거나 잘못 들어왔어요.</p>
      <Link to="/" className="btn btn-primary btn-lg">
        처음으로
      </Link>
    </div>
  )
}
