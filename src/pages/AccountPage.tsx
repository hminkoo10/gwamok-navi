import { type FormEvent, useState } from 'react'
import { FormError } from '../components/Form'
import { GoogleButton } from '../components/GoogleButton'
import { Link } from '../components/Link'
import { ApiError, auth, isAdminRole, myAiKey, ROLE_TEXT } from '../lib/api'
import { useApp } from '../lib/app'
import { dateTime } from '../lib/format'
import { nameProblem, tidyName } from '../lib/name'
import { navigate } from '../lib/router'
import type { SyncState } from '../lib/store'

const SYNC_TEXT: Record<SyncState, string> = {
  off: '',
  loading: '계정에 저장한 설계를 불러오는 중',
  'load-error': '계정에 저장한 설계를 불러오지 못했어요. 이 기기의 설계는 그대로 있고, 연결되면 합쳐서 저장해요.',
  saving: '계정에 저장하는 중',
  saved: '계정에 저장돼 있어요',
  error: '계정에 저장하지 못했어요. 고친 내용은 이 기기에 남아 있고, 연결되면 다시 저장해요.',
  rejected: '계정에 저장하지 못했어요.',
}

/** 내 이름(실명): 가입할 때 적은 이름. 예전에 이름 없이 가입했으면 여기서 적는다 */
function NameCard() {
  const { user, setUser, notify } = useApp()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!user) return null
  const open = editing || !user.name

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const problem = nameProblem(value)
    if (problem) return setError(problem)
    setBusy(true)
    setError('')
    try {
      const r = await auth.setName(tidyName(value))
      setUser({ ...user, ...r.user })
      setEditing(false)
      setValue('')
      notify('이름을 저장했어요.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '이름을 저장하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel-card" id="name">
      <h2 className="card-title">이름</h2>
      <p className="card-sub">
        {user.name ? '가입할 때 적은 실명이에요. 다른 사용자에게는 보이지 않아요.' : '아직 이름이 없어요. 실명을 적어 주세요. 다른 사용자에게는 보이지 않아요.'}
      </p>
      {!open ? (
        <div className="row-btns">
          <strong className="name-now">{user.name}</strong>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setValue(user.name)
              setEditing(true)
            }}
          >
            바꾸기
          </button>
        </div>
      ) : (
        <form className="form" onSubmit={(e) => void save(e)} noValidate>
          <label className="field">
            <span className="field-label">이름 (실명)</span>
            <input className="input" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="name" maxLength={30} placeholder="예: 김민준" />
          </label>
          <FormError message={error} />
          <div className="row-btns">
            <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
              {busy ? '저장하는 중' : '저장'}
            </button>
            {user.name && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  setEditing(false)
                  setError('')
                }}
              >
                취소
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  )
}

/**
 * 내 Gemini API 키: 관리자가 '사용자 키로 AI 쓰기'를 켰을 때 편제표 읽기·파일 읽기·문장으로 찾기에 쓴다.
 * 꺼져 있어도 등록해 둔 키가 있으면 보여서 지울 수 있게 한다
 */
function AiKeyCard() {
  const { user, setUser, features, notify } = useApp()
  const [value, setValue] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!user || (!features.userKey && !user.aiKey)) return null
  const key = user.aiKey ?? null

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const apiKey = value.trim()
    if (apiKey.length < 20) return setError('Google AI Studio에서 복사한 키를 붙여 넣어 주세요.')
    setBusy(true)
    setError('')
    try {
      const r = await myAiKey.save(apiKey)
      setUser({ ...user, aiKey: r.aiKey })
      setValue('')
      setEditing(false)
      notify(r.note ? `키를 등록했어요. ${r.note}` : '키를 등록했어요. 이제 AI 기능을 내 키로 써요.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '키를 등록하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirm(`등록한 Gemini API 키를 지울까요?${features.userKey ? ' 지우면 편제표 자동 읽기·파일 읽기·문장으로 찾기를 쓸 수 없어요.' : ''}`)) return
    setBusy(true)
    try {
      await myAiKey.remove()
      setUser({ ...user, aiKey: null })
      notify('키를 지웠어요. Google AI Studio에서도 그 키를 지우면 더 안전해요.')
    } catch (err) {
      notify(err instanceof ApiError ? err.message : '키를 지우지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel-card" id="ai-key">
      <h2 className="card-title">내 Gemini API 키</h2>
      <p className="card-sub">
        {features.userKey
          ? '편제표 자동 읽기·파일 읽기·문장으로 찾기를 이 키로 해요. 키가 없으면 이 기능들을 쓸 수 없어요.'
          : '지금은 관리자가 서버 AI를 쓰게 해 두어서 이 키를 쓰지 않아요.'}
      </p>
      {key && !editing ? (
        <>
          <dl className="kv">
            <div>
              <dt>등록한 키</dt>
              <dd className="num">{key.hint}</dd>
            </div>
            <div>
              <dt>등록</dt>
              <dd>{dateTime(key.addedAt)}</dd>
            </div>
          </dl>
          {!key.ok && <p className="callout is-warn">서버 설정이 바뀌어 이 키를 쓸 수 없어요. 키를 다시 등록해 주세요.</p>}
          <div className="row-btns">
            <button type="button" className="btn" disabled={busy} onClick={() => setEditing(true)}>
              다른 키로 바꾸기
            </button>
            <button type="button" className="btn btn-danger-quiet" disabled={busy} onClick={() => void remove()}>
              지우기
            </button>
          </div>
        </>
      ) : (
        <form className="form" onSubmit={(e) => void save(e)} noValidate>
          <label className="field">
            <span className="field-label">Google AI Studio API 키</span>
            <input
              type="password"
              className="input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="AI Studio에서 복사한 키를 붙여 넣으세요"
              aria-describedby="ai-key-help"
            />
          </label>
          <FormError message={error} />
          <div className="row-btns">
            <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
              {busy ? '키를 확인하는 중' : '확인하고 등록'}
            </button>
            {key && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  setEditing(false)
                  setValue('')
                  setError('')
                }}
              >
                취소
              </button>
            )}
          </div>
        </form>
      )}
      <p className="fine" id="ai-key-help">
        키는 암호화해서 저장하고, AI 기능을 쓸 때만 Google로 보내요. 등록할 때 짧은 질문 하나로 맞는 키인지 확인해요. 키는 다른 사람에게 보내거나 채팅에 올리지
        마세요. <Link to="/help/gemini-key">발급 방법 보기</Link>
      </p>
    </section>
  )
}

function DeleteAccount() {
  const { user, setUser, store, notify } = useApp()
  const [agree, setAgree] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!user) return null
  if (user.role === 'owner') return <p className="muted">대표 관리자 계정은 탈퇴할 수 없어요. 서버의 OWNER_EMAIL을 다른 계정으로 바꾼 뒤에 탈퇴할 수 있어요.</p>

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!agree) return setError('탈퇴에 동의해 주세요.')
    if (!confirm('계정과 계정에 저장한 설계를 모두 지울까요? 되돌릴 수 없어요.')) return
    setBusy(true)
    setError('')
    try {
      await auth.deleteAccount()
      setUser(null)
      store.clearLocal()
      notify('계정을 지웠어요.')
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '계정을 지우지 못했어요.')
      setBusy(false)
    }
  }

  return (
    <form className="form" onSubmit={(e) => void submit(e)} noValidate>
      <p className="muted">
        탈퇴하면 계정과 이름, 계정에 저장한 학교·설계, 등록한 Gemini API 키가 바로 지워지고 되돌릴 수 없어요. 이 기기에 남은 설계도 함께 지워요. 이용 기록은
        누가 했는지 알 수 없게 바꿔요. Google 계정은 그대로이고, 다시 로그인하면 새로 가입해요.
      </p>
      <label className="check">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>계정과 저장한 설계를 모두 지우는 데 동의해요</span>
      </label>
      <FormError message={error} />
      <div>
        <button type="submit" className="btn btn-danger" disabled={busy || !agree}>
          {busy ? '지우는 중' : '계정 지우기'}
        </button>
      </div>
    </form>
  )
}

export function AccountPage() {
  const { user, authReady, store, signOut, features } = useApp()

  if (!authReady) return <div className="wrap gate" aria-busy="true" />
  if (!user)
    return (
      <div className="wrap auth">
        <div className="auth-card">
          <h1 className="auth-title">로그인이 필요해요</h1>
          <p className="auth-sub">과목내비는 Google 계정으로 로그인해야 써요.</p>
          {features.login ? (
            <GoogleButton next="/account" />
          ) : (
            <p className="callout is-warn">지금은 로그인을 쓸 수 없어요. 서버에 Google 로그인이 아직 설정되지 않았어요.</p>
          )}
        </div>
      </div>
    )

  const syncText = SYNC_TEXT[store.sync]

  return (
    <div className="wrap page account">
      <header className="page-head">
        <p className="eyebrow">내 계정</p>
        <h1 className="page-title account-email">{user.name || user.email}</h1>
        <p className="page-sub">
          {user.name ? `${user.email} · ` : ''}
          {ROLE_TEXT[user.role]} · Google 계정으로 로그인 · {dateTime(user.createdAt, false)} 가입
        </p>
      </header>

      <div className="settings-list">
        <NameCard />

        <section className="panel-card">
          <h2 className="card-title">저장한 설계</h2>
          <p className="card-sub">
            {store.sync === 'saved' && store.savedAt
              ? `${syncText} · ${dateTime(store.savedAt)}`
              : store.sync === 'rejected' && store.syncMessage
                ? `${syncText} ${store.syncMessage}`
                : syncText}
          </p>
          <dl className="kv">
            <div>
              <dt>학교</dt>
              <dd>
                {store.school
                  ? `${store.school.name} (${store.school.cohort}학년도 입학${store.school.track ? ` · ${store.school.track}` : ''})`
                  : '아직 고르지 않았어요'}
              </dd>
            </div>
            <div>
              <dt>저장한 학교</dt>
              <dd>{store.schools.length}곳</dd>
            </div>
            <div>
              <dt>슬롯</dt>
              <dd>{store.slots.length}개</dd>
            </div>
            <div>
              <dt>분야 · 대학</dt>
              <dd>
                분야 {store.prefs.majors.length}개 · 대학 {store.prefs.univs.length}곳
              </dd>
            </div>
          </dl>
          <div className="row-btns">
            {(store.sync === 'error' || store.sync === 'load-error') && (
              <button type="button" className="btn" onClick={store.retrySync}>
                지금 다시 시도
              </button>
            )}
            <Link to={store.school ? '/plan' : '/start'} className="btn">
              {store.school ? '내 과목 설계 보기' : '시작하기'}
            </Link>
            {isAdminRole(user.role) && (
              <Link to="/admin" className="btn">
                관리 화면
              </Link>
            )}
          </div>
        </section>

        <AiKeyCard />

        <section className="panel-card">
          <h2 className="card-title">로그아웃</h2>
          <p className="card-sub">
            로그아웃하면 이 기기에 남은 설계를 지워요. 계정에는 그대로 남아 있어요. 브라우저를 닫아도 로그아웃되지 않으니, 같이 쓰는 컴퓨터에서는 꼭
            로그아웃하세요.
          </p>
          <div>
            <button type="button" className="btn" onClick={() => void signOut()}>
              로그아웃
            </button>
          </div>
        </section>

        <details className="panel-card danger-zone">
          <summary>
            <span className="card-title">탈퇴</span>
            <span className="card-sub">계정과 계정에 저장한 설계를 지워요</span>
          </summary>
          <DeleteAccount />
        </details>
      </div>
    </div>
  )
}
