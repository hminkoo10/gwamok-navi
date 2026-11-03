import { type FormEvent, useEffect, useState } from 'react'
import { Dialog } from '../../components/Dialog'
import { FormError } from '../../components/Form'
import { UNIV_BY_ID, UNIVERSITIES } from '../../data/universities'
import { refreshAdmissions } from '../../lib/admissions'
import { type CheckRow, dataAdmin, type ImportRow, type Proposal, type WatchRow } from '../../lib/admin'
import { ApiError } from '../../lib/api'
import { useApp } from '../../lib/app'
import { dateTime } from '../../lib/format'
import { useLoad } from '../../lib/hooks'

const STATUS_CLASS: Record<string, string> = { 바뀜: 'is-warn', 없어짐: 'is-warn', '연결 실패': '', 그대로: 'is-ok', 확인함: 'is-ok' }
const name = (univ: string) => (univ ? (UNIV_BY_ID.get(univ)?.short ?? univ) : '공통')
/** 서버·원문에서 온 주소는 http(s)일 때만 링크로 건다 */
const safeHref = (url: string) => {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined
  } catch {
    return undefined
  }
}

/** 한 대학 전형 자료 고치기 (JSON, 서버가 검사한다). 대학마다 key를 달리 줘서 앞서 연 대학의 고치던 글이 남지 않게 한다 */
function PlanEditor({ univ, onClose, onSaved }: { univ: string | null; onClose: () => void; onSaved: () => void }) {
  const { notify } = useApp()
  const loaded = useLoad(
    () => (univ ? dataAdmin.plan(univ).then((r) => ({ univ, text: JSON.stringify(r.plan, null, 2), tag: r.tag })) : Promise.resolve(null)),
    univ ?? '',
  )
  // 받은 자료가 지금 연 대학 것일 때만 쓴다 (다른 대학 자료를 이 대학 것으로 저장하지 않게)
  const loadedText = loaded.data && loaded.data.univ === univ ? loaded.data.text : null
  const [text, setText] = useState<string | null>(null)
  const [summary, setSummary] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const value = text ?? loadedText ?? ''

  const save = async () => {
    if (!univ) return
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      setError('JSON 형식이 맞지 않아요.')
      return
    }
    setBusy(true)
    setError('')
    try {
      // 불러온 판을 함께 보내, 편집기를 연 뒤 바뀐 자료(다른 관리자·AI 제안 반영)를 덮어쓰지 않게 한다
      await dataAdmin.savePlan(univ, parsed, summary, loaded.data?.univ === univ ? loaded.data.tag : undefined)
      notify('저장했어요. 모든 화면에 바로 반영돼요.')
      await refreshAdmissions()
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '저장하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={univ !== null}
      wide
      title={univ ? `${name(univ)} 전형 자료 고치기` : ''}
      onClose={onClose}
      footer={
        <>
          <span className="foot-note">규칙: data-src/admissions2028/README.md</span>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !value} onClick={() => void save()}>
            {busy ? '저장하는 중' : '저장'}
          </button>
        </>
      }
    >
      <div className="plan-editor">
        <label className="fieldset">
          <span>바꾼 내용 (소식에 보여요)</span>
          <input
            className="input"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            maxLength={160}
            placeholder="예: 모집요강 발표로 학교추천전형 인원 672→680"
          />
        </label>
        <FormError message={error || (loadedText === null ? loaded.error : '')} />
        {loadedText === null ? (
          !loaded.error && <p className="progress-line muted">불러오는 중</p>
        ) : (
          <textarea className="code-area" value={value} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="전형 자료 JSON" />
        )}
      </div>
    </Dialog>
  )
}

const PROPOSAL_STATUS: Record<Proposal['status'], string> = {
  pending: '검토 기다림',
  applied: '반영함',
  dismissed: '버림',
  failed: '직접 확인',
  none: '바뀐 전형 없음',
}

/** AI가 원문에서 찾은 고칠 곳 하나 */
function ProposalCard({ p, onApply, onDismiss }: { p: Proposal; onApply: () => void; onDismiss: () => void }) {
  const open = p.status === 'pending' || p.status === 'failed'
  return (
    <li className={`proposal is-${p.status}`}>
      <div className="proposal-head">
        <div>
          <strong>{name(p.univ)}</strong> <span className={`badge ${open ? 'is-warn' : 'is-ok'}`}>{PROPOSAL_STATUS[p.status]}</span>
          <p className="proposal-sum">{p.summary}</p>
          <p className="muted small">
            {dateTime(p.createdAt)}
            {p.pages.length > 0 && ` · 달라진 곳 ${p.pages.slice(0, 8).join(', ')}${p.pages.length > 8 ? ' 외' : ''}`}
            {p.decidedBy && ` · ${p.decidedBy}`}
          </p>
        </div>
        {open && (
          <div className="row-actions">
            {p.status === 'pending' && (
              <button type="button" className="btn btn-primary btn-sm" onClick={onApply}>
                반영
              </button>
            )}
            <button type="button" className="btn btn-sm" onClick={onDismiss}>
              {p.status === 'failed' ? '확인함' : '버리기'}
            </button>
          </div>
        )}
      </div>
      {p.lines.length > 0 && (
        <div className="table-wrap">
          <table className="table proposal-table">
            <thead>
              <tr>
                <th>전형</th>
                <th>항목</th>
                <th>지금</th>
                <th>바꿀 값</th>
              </tr>
            </thead>
            <tbody>
              {p.lines.map((l, i) => (
                <tr key={i}>
                  <td data-label="전형">{l.track}</td>
                  <td data-label="항목">{l.field}</td>
                  <td data-label="지금" className="was">
                    {l.before || '-'}
                  </td>
                  <td data-label="바꿀 값" className="now">
                    {l.after || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {p.detail && <p className="proposal-detail">{p.detail}</p>}
    </li>
  )
}

function AddSource({ onAdded }: { onAdded: () => void }) {
  const { notify } = useApp()
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [univ, setUniv] = useState('')
  const [error, setError] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await dataAdmin.addSource(url.trim(), title.trim(), univ)
      setUrl('')
      setTitle('')
      notify('감시할 원문을 넣었어요.')
      onAdded()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '넣지 못했어요.')
    }
  }
  return (
    <form className="add-source" onSubmit={(e) => void submit(e)}>
      <div className="inline-fields">
        <label className="fieldset">
          <span>원문 주소 (https)</span>
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="예: 대학 입학처 모집요강 공지 주소" />
        </label>
        <label className="fieldset">
          <span>이름</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="예: 2028 수시 모집요강" />
        </label>
        <label className="fieldset">
          <span>대학</span>
          <select className="input" value={univ} onChange={(e) => setUniv(e.target.value)}>
            <option value="">공통</option>
            {UNIVERSITIES.map((u) => (
              <option key={u.id} value={u.id}>
                {u.short}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-primary" disabled={!url.trim()}>
          넣기
        </button>
      </div>
      <FormError message={error} />
    </form>
  )
}

const IMPORT_STATUS: Record<ImportRow['status'], { label: string; cls: string }> = {
  waiting: { label: '기다림', cls: '' },
  running: { label: '옮기는 중', cls: 'is-warn' },
  done: { label: '옮김', cls: 'is-ok' },
  failed: { label: '못 함', cls: 'is-warn' },
  skipped: { label: '안 함', cls: '' },
}
const IMPORT_FILTERS: { key: ImportRow['status'] | 'all'; label: string }[] = [
  { key: 'failed', label: '못 함' },
  { key: 'waiting', label: '기다림' },
  { key: 'done', label: '옮김' },
  { key: 'skipped', label: '안 함' },
  { key: 'all', label: '전체' },
]

const CHECK_STATUS: Record<CheckRow['status'], { label: string; cls: string }> = {
  waiting: { label: '검수 기다림', cls: '' },
  running: { label: '검수 중', cls: 'is-warn' },
  done: { label: 'AI 검수함', cls: 'is-ok' },
  failed: { label: '검수 못 함', cls: 'is-warn' },
}

/** 가져온 대학의 검수 상태 (고친 곳 수, 못 한 까닭) */
function CheckBadge({ check }: { check: CheckRow | undefined }) {
  if (!check) return null
  const s = CHECK_STATUS[check.status]
  return (
    <>
      {' '}
      <span className={`badge ${s.cls}`}>{s.label}</span>
      {check.status === 'done' && <span className="muted small"> {check.changes ? `${check.changes}곳 고침` : '고칠 곳 없음'}</span>}
      {check.detail && check.status !== 'waiting' && <span className="muted small"> {check.detail}</span>}
    </>
  )
}

/** 전형 자료가 없는 대학의 시행계획을 서버가 받아 AI로 옮긴다. 켜 두면 하루 한도 안에서 한 시간마다 이어서 한다 */
function ImportCard({ onChanged }: { onChanged: () => void }) {
  const { notify } = useApp()
  const data = useLoad(() => dataAdmin.imports(), 'imports')
  // 고르기 전에는 못 한 대학이 있으면 그것을, 없으면 기다리는 대학을 보여 준다
  const [chosen, setFilter] = useState<ImportRow['status'] | 'all' | null>(null)
  const [urlFor, setUrlFor] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const { reload } = data
  const enabled = data.data?.state.enabled ?? false
  const current = data.data?.state.current ?? null
  const checking = data.data?.verify.current ?? null

  // 옮기거나 검수하는 동안에는 몇 초마다 새로 받는다
  useEffect(() => {
    if (!enabled && !current && !checking) return
    const t = setInterval(reload, 8000)
    return () => clearInterval(t)
  }, [enabled, current, checking, reload])

  if (data.error && !data.data) return <p className="form-error">{data.error}</p>
  if (!data.data) return null
  const { rows, state, ai, verify } = data.data
  const checks = new Map(data.data.checks.map((c) => [c.univ, c]))
  const checkWaiting = data.data.checks.filter((c) => c.status === 'waiting').length
  const count = (s: ImportRow['status']) => rows.filter((r) => r.status === s).length
  const filter = chosen ?? (count('failed') ? 'failed' : 'waiting')
  const shown = filter === 'all' ? rows : rows.filter((r) => r.status === filter || (filter === 'waiting' && r.status === 'running'))

  const toggle = async () => {
    try {
      await dataAdmin.toggleImports(!enabled)
      notify(enabled ? '가져오기를 멈췄어요. 옮기던 대학은 끝까지 옮겨요.' : '가져오기를 시작했어요. 대학 하나에 1~3분 걸려요.')
      reload()
    } catch (e) {
      notify(e instanceof ApiError ? e.message : '바꾸지 못했어요.')
    }
  }
  const review = async (univ: string) => {
    try {
      await dataAdmin.reviewPlan(univ)
      notify(`${name(univ)} 자료를 검수 AI가 원문과 대조하고 있어요. 1~3분 걸려요.`)
      reload()
    } catch (e) {
      notify(e instanceof ApiError ? e.message : '검수를 시작하지 못했어요.')
    }
  }
  const run = async (r: ImportRow, withUrl?: string) => {
    setError('')
    try {
      await dataAdmin.runImport(r.univ, withUrl)
      notify(`${name(r.univ)} 시행계획을 받아 AI로 옮기고 있어요. 1~3분 걸려요.`)
      setUrlFor(null)
      setUrl('')
      reload()
      onChanged()
    } catch (e) {
      const message = e instanceof ApiError ? e.message : '시작하지 못했어요.'
      if (withUrl !== undefined) setError(message)
      else notify(message)
    }
  }

  return (
    <section className="panel-card">
      <div className="card-head">
        <h2 className="card-title">전형 없는 대학 가져오기</h2>
        <button type="button" className={`btn btn-sm${enabled ? '' : ' btn-primary'}`} disabled={!ai && !enabled} onClick={() => void toggle()}>
          {enabled ? '멈추기' : '가져오기 시작'}
        </button>
      </div>
      <p className="card-sub">
        전형 자료가 없는 대학의 2028학년도 시행계획을 서버가 대교협 파일 저장소와 대학 입학처에서 받아 AI로 옮겨요. 옮긴 전형은 바로 모두에게 보이고 'AI가 옮김'
        표시가 붙어요. 대학마다 AI를 3~6번 불러서, AI 연결에 Gemini(무료 키)가 있으면 지금 고른 연결과 상관없이 Gemini로 옮겨요. 옮긴 뒤에는 검수 AI(Gemini가
        아닌 연결, 예: Claude)가 원문과 대조해 틀린 곳을 고치고 'AI 검수' 표시를 붙여요.
      </p>
      <p className="muted small">
        {ai
          ? `가져오기 AI: ${ai.name} (${state.model && state.model !== ai.model ? `한도 때문에 ${state.model}` : ai.model})`
          : 'AI가 설정되지 않았어요. AI 연결 탭에서 먼저 연결해 주세요.'}{' '}
        · 오늘 {state.doneToday}/{state.limit}곳{current ? ` · ${name(current)} 옮기는 중` : ''}
        {state.note ? ` · ${state.note}` : ''}
      </p>
      <p className="muted small">
        {verify.ai ? `검수 AI: ${verify.ai.name} (${verify.ai.model})` : '검수할 AI 연결이 없어요. Gemini가 아닌 연결(예: Claude)을 넣으면 검수해요.'}
        {verify.enabled ? ` · 오늘 ${verify.doneToday}/${verify.limit}곳 · 검수 기다림 ${checkWaiting}곳` : ' · 검수를 꺼 두었어요 (설정)'}
        {checking ? ` · ${name(checking)} 검수 중` : ''}
        {verify.note ? ` · ${verify.note}` : ''}
      </p>
      <div className="chips" role="group" aria-label="상태로 보기">
        {IMPORT_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`chip chip-sm${filter === f.key ? ' is-on' : ''}`}
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {f.label} {f.key === 'all' ? rows.length : count(f.key) + (f.key === 'waiting' ? count('running') : 0)}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>대학</th>
              <th>상태</th>
              <th>원문</th>
              <th>
                <span className="sr-only">관리</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.univ}>
                <td data-label="대학">
                  <strong>{name(r.univ)}</strong>
                </td>
                <td data-label="상태">
                  <span className={`badge ${IMPORT_STATUS[r.status].cls}`}>{IMPORT_STATUS[r.status].label}</span>
                  {r.status === 'done' && <span className="muted small"> 전형 {r.tracks}개</span>}
                  {r.detail && <span className="muted small"> {r.detail}</span>}
                  {r.status === 'done' && <CheckBadge check={checks.get(r.univ)} />}
                </td>
                <td data-label="원문">
                  {r.url ? (
                    <a href={safeHref(r.url)} target="_blank" rel="noreferrer noopener">
                      {r.custom ? '넣은 주소' : '원문'}
                    </a>
                  ) : (
                    <span className="muted">{r.status === 'failed' ? '찾지 못함' : '자동으로 찾기'}</span>
                  )}
                  {urlFor === r.univ && (
                    <form
                      className="inline-fields"
                      onSubmit={(e) => {
                        e.preventDefault()
                        void run(r, url.trim())
                      }}
                    >
                      <label className="fieldset">
                        <span>시행계획 파일이나 게시글 주소 (https)</span>
                        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
                      </label>
                      <button type="submit" className="btn btn-primary btn-sm" disabled={!url.trim()}>
                        이 주소로 가져오기
                      </button>
                      <FormError message={error} />
                    </form>
                  )}
                </td>
                <td className="row-actions">
                  {r.status === 'done' && checks.has(r.univ) && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!verify.ai || checks.get(r.univ)?.status === 'running'}
                      onClick={() => void review(r.univ)}
                    >
                      {checks.get(r.univ)?.status === 'done' ? '다시 검수' : 'AI 검수'}
                    </button>
                  )}
                  <button type="button" className="btn btn-sm" disabled={!ai || r.status === 'running'} onClick={() => void run(r)}>
                    {r.status === 'done' ? '다시 가져오기' : '가져오기'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    aria-expanded={urlFor === r.univ}
                    onClick={() => {
                      setUrlFor(urlFor === r.univ ? null : r.univ)
                      setUrl('')
                      setError('')
                    }}
                  >
                    주소 넣기
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <p className="empty-table">이 상태인 대학이 없어요.</p>}
      </div>
    </section>
  )
}

export function DataTab() {
  const { notify } = useApp()
  const data = useLoad(() => dataAdmin.overview(), 'data')
  const [checking, setChecking] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [showOld, setShowOld] = useState(false)
  const busy = data.data?.checking.length ?? 0
  const { reload } = data

  // AI가 확인하는 동안에는 몇 초마다 새로 받아 결과를 보여 준다
  useEffect(() => {
    if (!busy) return
    const t = setInterval(reload, 5000)
    return () => clearInterval(t)
  }, [busy, reload])

  if (data.error && !data.data) return <p className="form-error">{data.error}</p>
  if (!data.data) return <p className="progress-line muted">불러오는 중</p>
  const { admissions, sources, pending, updates, proposals, ai } = data.data
  const open = proposals.filter((p) => p.status === 'pending' || p.status === 'failed')
  const old = proposals.filter((p) => p.status !== 'pending' && p.status !== 'failed')
  const checkingSet = new Set(data.data.checking)
  const overridden = new Map(admissions.overrides.map((o) => [o.key, o]))
  const visibleSources = showAll ? sources : sources.filter((s) => s.pending || s.status === '연결 실패' || s.custom)
  const aiPlans = admissions.plans.filter((p) => p.ai).length
  const aiChecked = admissions.plans.filter((p) => p.ai && p.aiCheck).length

  const runCheck = async () => {
    setChecking(true)
    try {
      const r = await dataAdmin.check()
      notify(r.changed ? `원문 ${r.changed}곳이 바뀌었어요.` : `원문 ${r.checked}곳을 확인했어요. 바뀐 곳이 없어요.`)
      data.reload()
    } catch (e) {
      notify(e instanceof ApiError ? e.message : '확인하지 못했어요.')
    } finally {
      setChecking(false)
    }
  }
  const checkPlan = async (univ: string) => {
    try {
      await dataAdmin.checkPlan(univ)
      notify(`${name(univ)} 원문을 받아 AI로 확인하고 있어요. 1~3분 걸려요.`)
      data.reload()
    } catch (e) {
      notify(e instanceof ApiError ? e.message : '확인을 시작하지 못했어요.')
    }
  }
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn()
      notify(done)
      data.reload()
      await refreshAdmissions()
    } catch (e) {
      notify(e instanceof ApiError ? e.message : '처리하지 못했어요.')
      // 반영하지 못했어도 제안이 직접 확인으로 돌아갔을 수 있어 새로 받는다
      data.reload()
    }
  }

  return (
    <div className="admin-data">
      <div className="stat-grid">
        <div className="stat">
          <span className="stat-label">전형 자료</span>
          <strong className="stat-num num">{admissions.plans.length}곳</strong>
          <span className="stat-sub">전형 {admissions.plans.reduce((n, p) => n + p.tracks, 0).toLocaleString('ko-KR')}개</span>
        </div>
        <div className="stat">
          <span className="stat-label">관리자가 고친 대학</span>
          <strong className="stat-num num">{admissions.overrides.length}</strong>
          <span className="stat-sub">{admissions.updatedAt ? `최근 ${dateTime(admissions.updatedAt)}` : '아직 없어요'}</span>
        </div>
        <div className={`stat${aiPlans > aiChecked ? ' is-warn' : ''}`}>
          <span className="stat-label">AI가 옮긴 대학</span>
          <strong className="stat-num num">{aiPlans}</strong>
          <span className="stat-sub">{aiPlans ? `검수 AI가 확인한 곳 ${aiChecked}` : '확인할 것이 없어요'}</span>
        </div>
        <div className={`stat${open.length ? ' is-warn' : ''}`}>
          <span className="stat-label">AI가 찾은 변경</span>
          <strong className="stat-num num">{open.length}</strong>
          <span className="stat-sub">{open.length ? '아래에서 반영하거나 버려 주세요' : pending ? `바뀐 원문 ${pending}곳` : '확인할 것이 없어요'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">자료 판</span>
          <strong className="stat-num num small-num">{admissions.version}</strong>
          <span className="stat-sub">바뀌면 열린 화면도 새로 받아요</span>
        </div>
      </div>

      <ImportCard onChanged={data.reload} />

      <section className="panel-card">
        <div className="card-head">
          <h2 className="card-title">AI가 찾은 변경</h2>
          {busy > 0 && <span className="muted small">{data.data.checking.map(name).join(', ')} 확인 중</span>}
        </div>
        <p className="card-sub">
          {ai
            ? '대학 원문이 바뀌면 서버가 새 파일을 받아 지난번과 달라진 쪽만 AI로 읽고, 고칠 곳을 여기에 올려요. 반영하면 모두에게 바로 보이고 대입 정보 소식에 남아요. 설정에서 바로 반영을 켜면 모집인원이 조금 바뀐 정도의 작은 고침은 확인 없이 반영해요.'
            : '서버에 AI가 설정돼 있지 않아 원문이 바뀌어도 고칠 곳을 찾지 않아요. 원문 감시 알림을 보고 직접 고쳐 주세요.'}
        </p>
        {open.length ? (
          <ul className="proposal-list">
            {open.map((p) => (
              <ProposalCard
                key={p.id}
                p={p}
                onApply={() => {
                  if (confirm(`${name(p.univ)} 자료에 반영할까요? 모든 사용자에게 바로 보여요.`)) void act(() => dataAdmin.applyProposal(p.id), '반영했어요.')
                }}
                onDismiss={() => void act(() => dataAdmin.dismissProposal(p.id), '정리했어요.')}
              />
            ))}
          </ul>
        ) : (
          <p className="muted">검토할 제안이 없어요.</p>
        )}
        {old.length > 0 && (
          <>
            <button type="button" className="btn-link" aria-expanded={showOld} onClick={() => setShowOld(!showOld)}>
              {showOld ? '지난 제안 접기' : `지난 제안 ${old.length}개 보기`}
            </button>
            {showOld && (
              <ul className="proposal-list">
                {old.map((p) => (
                  <ProposalCard key={p.id} p={p} onApply={() => undefined} onDismiss={() => undefined} />
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="panel-card">
        <div className="card-head">
          <h2 className="card-title">원문 감시</h2>
          <button type="button" className="btn btn-primary btn-sm" disabled={checking} onClick={() => void runCheck()}>
            {checking ? '확인하는 중' : '지금 확인'}
          </button>
        </div>
        <p className="card-sub">
          대학별 전형계획 파일과 대교협 자료집을 서버가 6시간마다 확인해요 (WATCH_INTERVAL_HOURS). 바뀌면 여기에 뜨고, AI가 바뀐 곳을 찾아 위 'AI가 찾은 변경'에
          올려요.
        </p>
        <label className="switch">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          모든 원문 보기 ({sources.length}곳)
        </label>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>대학</th>
                <th>원문</th>
                <th>상태</th>
                <th>마지막 확인</th>
                <th>
                  <span className="sr-only">관리</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleSources.map((s: WatchRow) => (
                <tr key={s.key}>
                  <td data-label="대학">{name(s.univ)}</td>
                  <td data-label="원문">
                    <a href={safeHref(s.url)} target="_blank" rel="noreferrer noopener">
                      {s.title}
                    </a>
                  </td>
                  <td data-label="상태">
                    <span className={`badge ${STATUS_CLASS[s.status] ?? ''}`}>{s.status}</span>
                    {s.detail && <span className="muted small"> {s.detail}</span>}
                  </td>
                  <td data-label="마지막 확인" className="num">
                    {dateTime(s.checkedAt)}
                  </td>
                  <td className="row-actions">
                    {s.pending && (
                      <button type="button" className="btn btn-sm" onClick={() => void act(() => dataAdmin.ack(s.key), '확인했어요.')}>
                        확인함
                      </button>
                    )}
                    {s.custom && (
                      <button type="button" className="btn btn-sm btn-danger-quiet" onClick={() => void act(() => dataAdmin.removeSource(s.key), '지웠어요.')}>
                        지우기
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visibleSources.length && <p className="empty-table">바뀐 원문이 없어요. 모든 원문을 보려면 위에서 켜세요.</p>}
        </div>
        <details className="add-source-box">
          <summary>감시할 원문 넣기</summary>
          <AddSource onAdded={data.reload} />
        </details>
      </section>

      <section className="panel-card">
        <h2 className="card-title">대학별 전형 자료</h2>
        <p className="card-sub">고치면 검사를 통과한 뒤 바로 모든 사용자에게 보이고, 대입 정보 소식에 남아요. 되돌리면 배포한 자료로 돌아가요.</p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>대학</th>
                <th>원문</th>
                <th>전형</th>
                <th>고침</th>
                <th>
                  <span className="sr-only">관리</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {admissions.plans.map((p) => {
                const o = overridden.get(p.univ)
                return (
                  <tr key={p.univ}>
                    <td data-label="대학">
                      <strong>{name(p.univ)}</strong>
                      {p.ai && (
                        <>
                          {' '}
                          <span className={`badge ${p.aiCheck ? 'is-ok' : 'is-warn'}`}>{p.aiCheck ? 'AI가 옮기고 AI가 검수함' : 'AI가 옮김'}</span>
                        </>
                      )}
                    </td>
                    <td data-label="원문">
                      <a href={safeHref(p.url)} target="_blank" rel="noreferrer noopener">
                        {p.date}
                      </a>
                    </td>
                    <td data-label="전형" className="num">
                      {p.tracks}
                    </td>
                    <td data-label="고침">{o ? `${o.updatedBy} · ${dateTime(o.updatedAt, false)}` : '-'}</td>
                    <td className="row-actions">
                      {ai && (
                        <button type="button" className="btn btn-sm" disabled={checkingSet.has(p.univ)} onClick={() => void checkPlan(p.univ)}>
                          {checkingSet.has(p.univ) ? '확인 중' : '원문 변경 확인'}
                        </button>
                      )}
                      {p.ai && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => void act(() => dataAdmin.reviewPlan(p.univ), '검수 AI가 원문과 대조하고 있어요. 1~3분 걸려요.')}
                        >
                          {p.aiCheck ? '다시 검수' : 'AI 검수'}
                        </button>
                      )}
                      {p.ai && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => {
                            if (confirm(`${name(p.univ)} 자료를 사람이 원문과 견줘 확인했나요? 'AI가 옮김' 표시가 사라져요.`))
                              void act(() => dataAdmin.verifyPlan(p.univ), '확인 표시를 했어요.')
                          }}
                        >
                          확인함
                        </button>
                      )}
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(p.univ)}>
                        고치기
                      </button>
                      {o && (
                        <button
                          type="button"
                          className="btn btn-sm btn-danger-quiet"
                          onClick={() => {
                            if (confirm(`${name(p.univ)} 자료를 배포한 자료로 되돌릴까요?`)) void act(() => dataAdmin.revert(p.univ), '되돌렸어요.')
                          }}
                        >
                          되돌리기
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel-card">
        <h2 className="card-title">대입 정보 소식</h2>
        {updates.length ? (
          <ul className="log-list">
            {updates.map((u) => (
              <li key={u.id}>
                <span className="log-time num">{dateTime(u.createdAt)}</span>
                <span>
                  <strong>{name(u.key)}</strong> {u.summary}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">아직 없어요.</p>
        )}
      </section>

      <PlanEditor key={editing ?? ''} univ={editing} onClose={() => setEditing(null)} onSaved={data.reload} />
    </div>
  )
}
