import { type FormEvent, useState } from 'react'
import { ApiError, auth } from '../lib/api'
import { useApp } from '../lib/app'
import { nameProblem, tidyName } from '../lib/name'
import { FormError } from './Form'
import { Link } from './Link'

/**
 * 실명을 받기 전에 가입해 이름이 없는 계정은 다음에 들어올 때 이름부터 받는다.
 * 예전 가입 동의에 이름이 없었으므로 이름 수집 동의를 따로 받는다. 내 계정 화면은 막지 않는다 (탈퇴할 수 있게).
 */
export function NameGate() {
  const { user, setUser, notify, signOut } = useApp()
  const [name, setName] = useState('')
  const [agree, setAgree] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!user) return null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const problem = nameProblem(name)
    if (problem) return setError(problem)
    if (!agree) return setError('이름을 모으고 쓰는 데 동의해 주세요.')
    setBusy(true)
    setError('')
    try {
      const r = await auth.setName(tidyName(name))
      setUser({ ...user, ...r.user })
      notify('이름을 저장했어요.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '이름을 저장하지 못했어요.')
      setBusy(false)
    }
  }

  return (
    <div className="wrap auth">
      <div className="auth-card">
        <h1 className="auth-title">이름을 적어 주세요</h1>
        <p className="auth-sub">이제 가입할 때 실명을 받아요. 예전에 가입한 계정도 계속 쓰려면 이름을 한 번 적어 주세요.</p>
        <form className="form" onSubmit={(e) => void submit(e)} noValidate>
          <p className="auth-account">
            <span className="muted">로그인한 Google 계정</span>
            <strong>{user.email}</strong>
          </p>
          <label className="field">
            <span className="field-label">
              이름 (실명) <em className="req">필수</em>
            </span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={30} placeholder="예: 김민준" />
          </label>
          <label className="check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>
              이름(실명)을 모으고 쓰는 데 동의해요 <em className="req">필수</em>
            </span>
          </label>
          <p className="fine">다른 사용자에게는 보이지 않아요. 탈퇴할 때까지 보관하고 탈퇴하면 바로 지워요.</p>
          <FormError message={error} />
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
            {busy ? '저장하는 중' : '저장하고 계속하기'}
          </button>
        </form>
        <div className="auth-foot">
          <p className="muted">
            이름을 적고 싶지 않으면{' '}
            <button type="button" className="btn-link" onClick={() => void signOut()}>
              로그아웃
            </button>
            하거나 <Link to="/account">내 계정</Link>에서 탈퇴할 수 있어요.
          </p>
        </div>
      </div>
    </div>
  )
}
