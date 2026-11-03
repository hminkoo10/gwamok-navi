import { type FormEvent, useState } from 'react'
import { FormError } from '../components/Form'
import { GoogleButton } from '../components/GoogleButton'
import { Link } from '../components/Link'
import { ApiError, auth } from '../lib/api'
import { safeNext, useApp } from '../lib/app'
import { useLoad } from '../lib/hooks'
import { nameProblem, tidyName } from '../lib/name'
import { navigate, useLocation } from '../lib/router'

/** 가입 동의: Google 로그인을 처음 한 사람에게 실명을 받고, 만 14세 이상·개인정보 수집에 동의를 받아 계정을 만든다 */
function Consent({ email }: { email: string }) {
  const { setUser, store, notify } = useApp()
  const [name, setName] = useState('')
  const [agreeAge, setAgreeAge] = useState(false)
  const [agreePrivacy, setAgreePrivacy] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const problem = nameProblem(name)
    if (problem) return setError(problem)
    if (!agreeAge || !agreePrivacy) return setError('필수 항목에 동의해 주세요.')
    setBusy(true)
    setError('')
    try {
      const r = await auth.complete({ agreeAge, agreePrivacy, name: tidyName(name) })
      setUser(r.user)
      notify('가입했어요. 이제 고른 내용이 계정에 저장돼요.')
      navigate(r.next !== '/' ? r.next : store.school ? '/plan' : '/start', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '가입하지 못했어요.')
      setBusy(false)
    }
  }

  return (
    <form className="form" onSubmit={(e) => void submit(e)} noValidate>
      <p className="auth-account">
        <span className="muted">가입할 Google 계정</span>
        <strong>{email}</strong>
      </p>
      <label className="field">
        <span className="field-label">
          이름 (실명) <em className="req">필수</em>
        </span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          maxLength={30}
          placeholder="예: 김민준"
          aria-describedby="name-help"
        />
        <span className="field-hint" id="name-help">
          다른 사용자에게는 보이지 않아요.
        </span>
      </label>
      <div className="agree">
        <label className="check">
          <input
            type="checkbox"
            checked={agreeAge && agreePrivacy}
            onChange={(e) => {
              setAgreeAge(e.target.checked)
              setAgreePrivacy(e.target.checked)
            }}
          />
          <strong>모두 동의</strong>
        </label>
        <label className="check">
          <input type="checkbox" checked={agreeAge} onChange={(e) => setAgreeAge(e.target.checked)} />
          <span>
            만 14세 이상이에요 <em className="req">필수</em>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={agreePrivacy} onChange={(e) => setAgreePrivacy(e.target.checked)} />
          <span>
            개인정보 수집·이용에 동의해요 <em className="req">필수</em>
          </span>
        </label>
        <details className="agree-detail">
          <summary>무엇을 모으나요</summary>
          <dl>
            <div>
              <dt>모으는 것</dt>
              <dd>
                이름(실명), Google 계정 고유 번호와 이메일 주소, 이 서비스에 저장한 학교·분야·대학 선택과 편제표, 이용 기록(가입·로그인, 과목 설계에서 바꾼 것,
                편제표 찾기·읽기, 파일 읽기, 문장으로 분야 찾기, 신고를 언제 했는지). 사진·비밀번호, 올린 파일·적은 문장의 내용, IP 주소는 남기지 않아요.
              </dd>
            </div>
            <div>
              <dt>쓰는 곳</dt>
              <dd>
                로그인, 여러 기기에서 설계 이어 보기, 계정 관리(관리자가 가입한 사람을 알아보기), 서비스 운영과 부정 이용 확인. 이름과 이용 기록은 관리자만
                봐요.
              </dd>
            </div>
            <div>
              <dt>보관 기간</dt>
              <dd>계정과 설계는 탈퇴할 때까지 두고, 탈퇴하면 바로 지워요. 이용 기록은 1년 뒤 지우고, 탈퇴하면 누가 했는지 알 수 없게 바꿔요.</dd>
            </div>
          </dl>
          <p className="muted">동의하지 않으면 가입할 수 없어요. 과목내비는 로그인해야 쓸 수 있어요.</p>
        </details>
      </div>
      <FormError message={error} />
      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
        {busy ? '가입하는 중' : '가입하기'}
      </button>
    </form>
  )
}

export function SignupPage() {
  const { user, features } = useApp()
  const { query } = useLocation()
  const next = safeNext(query.get('next'))
  const pending = useLoad(() => (features.server ? auth.pending() : Promise.resolve({ pending: null })), `pending:${features.server}`)

  if (user)
    return (
      <div className="wrap auth">
        <div className="auth-card">
          <h1 className="auth-title">이미 로그인했어요</h1>
          <p className="auth-sub">{user.email} 계정으로 로그인돼 있어요.</p>
          <Link to="/account" className="btn btn-primary btn-lg btn-block">
            내 계정
          </Link>
        </div>
      </div>
    )

  if (!features.server || !features.signup)
    return (
      <div className="wrap gate">
        <h1 className="page-title">지금은 회원가입을 받지 않아요</h1>
        <p className="page-sub">이미 가입한 계정만 로그인할 수 있어요.</p>
        <Link to="/" className="btn btn-primary btn-lg">
          처음으로
        </Link>
      </div>
    )

  const waiting = pending.data?.pending ?? null

  return (
    <div className="wrap auth">
      <div className="auth-card">
        <h1 className="auth-title">{waiting ? '가입 동의' : '회원가입'}</h1>
        <p className="auth-sub">
          {waiting
            ? '처음 로그인했어요. 이름을 적고 아래에 동의하면 가입이 끝나요.'
            : 'Google 계정으로 가입해요. Google에서 로그인한 뒤 이 화면으로 돌아와 동의를 받아요.'}
        </p>
        {pending.loading && !pending.data ? (
          <p className="progress-line muted">확인하는 중</p>
        ) : waiting ? (
          <Consent email={waiting.email} />
        ) : features.login ? (
          <GoogleButton next={next} label="Google 계정으로 가입하기" />
        ) : (
          <p className="callout is-warn">지금은 가입을 쓸 수 없어요. 서버에 Google 로그인이 아직 설정되지 않았어요.</p>
        )}
        <div className="auth-foot">
          {waiting ? (
            <p className="muted">
              다른 계정으로 가입하려면 <a href={`/api/auth/google?next=${encodeURIComponent(waiting.next)}`}>다른 Google 계정 고르기</a>
            </p>
          ) : (
            <p>
              이미 가입했나요? <Link to={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}>로그인</Link>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
