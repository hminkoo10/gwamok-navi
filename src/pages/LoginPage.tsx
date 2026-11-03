import { GoogleButton } from '../components/GoogleButton'
import { Link } from '../components/Link'
import { safeNext, useApp } from '../lib/app'
import { useLocation } from '../lib/router'

/** 서버가 Google 로그인을 마치지 못하고 돌려보낼 때 붙이는 error 코드 → 안내 */
const ERRORS: Record<string, string> = {
  unavailable: '지금은 로그인을 쓸 수 없어요. 서버에 Google 로그인이 아직 설정되지 않았어요.',
  busy: '로그인 요청이 너무 많아요. 잠시 후 다시 해 주세요.',
  expired: '로그인 시간이 지났거나 다른 창에서 시작한 로그인이에요. 다시 해 주세요.',
  cancelled: 'Google 로그인을 취소했어요.',
  failed: 'Google 로그인을 마치지 못했어요. 이메일 확인을 마친 Google 계정인지 보고 다시 해 주세요.',
  disabled: '이용이 정지된 계정이에요. 관리자에게 문의해 주세요.',
  closed: '지금은 회원가입을 받지 않아요. 이미 가입한 계정만 로그인할 수 있어요.',
}

export function LoginPage() {
  const { user, features, store } = useApp()
  const { query } = useLocation()
  const next = safeNext(query.get('next'))
  // 주소에서 온 값이라 hasOwn으로만 찾음 (__proto__ 같은 상속 속성 방지)
  const code = query.get('error') ?? ''
  const error = Object.hasOwn(ERRORS, code) ? ERRORS[code] : ''

  if (!features.server)
    return (
      <div className="wrap gate">
        <h1 className="page-title">로그인을 쓸 수 없어요</h1>
        <p className="page-sub">이 주소에서는 서버 기능이 꺼져 있어요. 고른 내용은 이 기기에 저장돼요.</p>
      </div>
    )

  if (user)
    return (
      <div className="wrap auth">
        <div className="auth-card">
          <h1 className="auth-title">이미 로그인했어요</h1>
          <p className="auth-sub">{user.email} 계정으로 로그인돼 있어요.</p>
          <div className="auth-actions">
            <Link to={next ?? '/'} className="btn btn-primary btn-lg btn-block">
              계속하기
            </Link>
            <Link to="/account" className="btn btn-lg btn-block">
              내 계정
            </Link>
          </div>
        </div>
      </div>
    )

  return (
    <div className="wrap auth">
      <div className="auth-card">
        <h1 className="auth-title">로그인</h1>
        <p className="auth-sub">과목내비는 Google 계정으로 로그인해야 써요. 고른 학교와 과목 설계는 계정에 저장돼 다른 기기에서도 이어서 볼 수 있어요.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {features.login ? (
          <GoogleButton next={next ?? (store.school ? '/plan' : '/')} />
        ) : (
          <p className="callout is-warn">지금은 로그인을 쓸 수 없어요. 서버에 Google 로그인이 아직 설정되지 않았어요.</p>
        )}
        <div className="auth-foot">
          <p className="muted">
            {features.signup
              ? '처음이면 Google 로그인 뒤에 이름(실명)을 적고 가입 동의를 해요. Google 계정에서는 이메일만 받고 사진은 받지 않아요.'
              : '지금은 회원가입을 받지 않아요. 이미 가입한 계정만 로그인할 수 있어요.'}
          </p>
          <p className="muted">
            로그인·설계 저장·편제표 읽기 같은 이용 기록을 남겨요. 자세한 것은 <Link to="/help#privacy">개인정보 안내</Link>에 있어요.
          </p>
        </div>
      </div>
    </div>
  )
}
