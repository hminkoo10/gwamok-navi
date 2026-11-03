import { useState } from 'react'
import { Dialog } from '../../components/Dialog'
import { IconSearch } from '../../components/icons'
import { Pager } from '../../components/Pager'
import { SchoolEditor } from '../../components/SchoolEditor'
import type { School } from '../../data/schema'
import { TERMS } from '../../data/schema'
import { schoolFromLoose, termCredits } from '../../engine/school'
import { adminApi, type CurriculumItem, METHOD_LABEL } from '../../lib/admin'
import { ApiError } from '../../lib/api'
import { useApp, useNeedKey } from '../../lib/app'
import { dateTime, TERM_LABEL } from '../../lib/format'
import { useDebounced, useLoad } from '../../lib/hooks'
import { safeHref } from '../../lib/href'

const STATUS: [string, string][] = [
  ['', '모두'],
  ['visible', '보이는 것'],
  ['hidden', '숨긴 것'],
  ['verified', '확인됨'],
  ['reported', '신고 있음'],
]

/** 저장된 편제표 데이터를 화면용 학교로 (서버가 준 값도 다시 검사) */
function toSchool(item: CurriculumItem): School {
  const raw = (item.data && typeof item.data === 'object' ? item.data : {}) as Record<string, unknown>
  const s = schoolFromLoose(raw, {
    id: typeof raw.id === 'string' ? raw.id : `admin-${item.id}`,
    name: item.schoolName,
    region: item.region,
    cohort: item.cohort,
  })
  return { ...s, source: { title: item.sourceTitle, url: item.pageUrl }, ...(item.track ? { track: item.track } : {}) }
}

/** 학기별 과목을 한눈에 */
function TermsView({ school }: { school: School }) {
  return (
    <div className="cur-grid">
      {TERMS.map((id) => {
        const t = school.terms.find((x) => x.id === id)
        const tracks = school.tracks.flatMap((tr) => (tr.sets.some((s) => s.items.some((it) => it.term === id)) ? [tr] : []))
        return (
          <section key={id} className="cur-term">
            <h4>
              {TERM_LABEL[id]} <span className="num muted">{termCredits(school, id)}학점</span>
            </h4>
            <ul>
              {t?.fixed.map((f, i) => (
                <li key={`f${i}`}>
                  {f.subject}
                  {f.alt ? ` / ${f.alt}` : ''} <span className="num muted">{f.credits}</span>
                </li>
              ))}
              {t?.groups.map((g) => (
                <li key={g.id} className="cur-group">
                  <span className="muted">
                    {g.label} · {g.pick}과목 선택 · {g.credits}학점
                  </span>
                  <span>{g.options.join(', ')}</span>
                </li>
              ))}
              {tracks.map((tr) => (
                <li key={tr.id} className="cur-group">
                  <span className="muted">{tr.label} · 세트 선택</span>
                  <span>
                    {tr.sets
                      .map((s) =>
                        s.items
                          .filter((it) => it.term === id)
                          .map((it) => `${it.subject} ${it.credits}`)
                          .join('+'),
                      )
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                </li>
              ))}
              {!t?.fixed.length && !t?.groups.length && !tracks.length && <li className="muted">비어 있음</li>}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

/** 편제표 한 건 보기: 확인 표시·숨기기·고치기 */
export function CurriculumDialog({ id, onClose, onChanged }: { id: number | null; onClose: () => void; onChanged: () => void }) {
  const { notify, features } = useApp()
  const needKey = useNeedKey()
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const item = useLoad(() => (id ? adminApi.curriculum(id).then((r) => r.item) : Promise.resolve(null)), String(id))
  const data = item.data && item.data.id === id ? item.data : null
  const school = data ? toSchool(data) : null

  const update = async (patch: { hidden?: boolean; verified?: boolean }, done: string) => {
    if (!data) return
    setBusy(true)
    try {
      await adminApi.updateCurriculum(data.id, patch)
      notify(done)
      item.reload()
      onChanged()
    } catch (err) {
      notify(err instanceof ApiError ? err.message : '바꾸지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Dialog
        open={id !== null && !editing}
        wide
        title={data ? `${data.schoolName} ${data.cohort}학년도 입학${data.track ? ` · ${data.track}` : ''}` : '편제표'}
        onClose={onClose}
        footer={
          data && (
            <>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void update({ hidden: !data.hidden }, data.hidden ? '다시 보이게 했어요.' : '숨겼어요. 이제 이 편제표는 나오지 않아요.')}
              >
                {data.hidden ? '다시 보이기' : '숨기기'}
              </button>
              {/* 직접 넣은 편제표는 처음부터 확인된 것으로 봄 */}
              {data.method !== 'manual' && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void update({ verified: !data.verified }, data.verified ? '확인 표시를 풀었어요.' : '확인된 편제표로 표시했어요.')}
                >
                  {data.verified ? '확인 표시 풀기' : '원문과 맞아요 (확인 표시)'}
                </button>
              )}
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setEditing(true)}>
                고치기
              </button>
            </>
          )
        }
      >
        {!data && !item.error && <p className="progress-line muted">불러오는 중</p>}
        {item.error && <p className="form-error">{item.error}</p>}
        {data && school && (
          <div className="cur-view">
            <dl className="kv">
              <div>
                <dt>원문</dt>
                <dd>
                  {safeHref(data.pageUrl) ? (
                    <a href={safeHref(data.pageUrl)} target="_blank" rel="noreferrer noopener">
                      {data.sourceTitle || data.pageUrl}
                    </a>
                  ) : (
                    data.sourceTitle || '-'
                  )}
                </dd>
              </div>
              <div>
                <dt>가져온 방법</dt>
                <dd>
                  {METHOD_LABEL[data.method] ?? data.method}
                  {data.model ? ` (${data.model})` : ''} · {dateTime(data.createdAt)}
                </dd>
              </div>
              <div>
                <dt>상태</dt>
                <dd className="badges">
                  {data.verified || data.method === 'manual' ? <span className="badge is-ok">확인됨</span> : <span className="badge">확인 전</span>}
                  {data.hidden && <span className="badge is-warn">숨김</span>}
                </dd>
              </div>
            </dl>
            <TermsView school={school} />
          </div>
        )}
      </Dialog>
      {editing && school && data && (
        <SchoolEditor
          initial={school}
          aiEnabled={features.import && !needKey}
          onClose={() => setEditing(false)}
          onSave={(edited) => {
            adminApi
              .editCurriculum(data.id, edited)
              .then(() => {
                notify('고친 편제표를 새 판으로 저장했어요. 고치기 전 판은 숨겼어요.')
                setEditing(false)
                onChanged()
                onClose()
              })
              .catch((err) => notify(err instanceof ApiError ? err.message : '저장하지 못했어요.'))
          }}
        />
      )}
    </>
  )
}

export function CurriculaTab() {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [offset, setOffset] = useState(0)
  const [open, setOpen] = useState<number | null>(null)
  const query = useDebounced(q.trim(), 250)
  const list = useLoad(() => adminApi.curricula({ q: query, status, offset }), `${query}|${status}|${offset}`)

  return (
    <div className="admin-curricula">
      <div className="admin-toolbar">
        <div className="search">
          <IconSearch className="search-icon" />
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setOffset(0)
            }}
            placeholder="학교 이름이나 학과"
            aria-label="학교 이름이나 학과로 찾기"
          />
        </div>
        <div className="chips" role="group" aria-label="상태">
          {STATUS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`chip chip-sm${status === value ? ' is-on' : ''}`}
              aria-pressed={status === value}
              onClick={() => {
                setStatus(value)
                setOffset(0)
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="hint">학생들이 학교를 고르면 서버가 읽어 저장한 편제표예요. 같은 학교·입학년도·학과면 확인된 것, 없으면 가장 최근 것을 보여 줘요.</p>

      {list.error && <p className="form-error">{list.error}</p>}
      <div className={`table-wrap${list.loading ? ' is-loading' : ''}`}>
        <table className="table">
          <thead>
            <tr>
              <th>학교</th>
              <th>입학년도</th>
              <th>학과</th>
              <th>가져온 방법</th>
              <th>저장</th>
              <th>상태</th>
              <th>
                <span className="sr-only">보기</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.data?.items.map((c) => (
              <tr key={c.id} className={c.hidden ? 'is-dim' : ''}>
                <td data-label="학교">
                  <strong>{c.schoolName}</strong> <span className="muted">{c.region}</span>
                </td>
                <td data-label="입학년도" className="num">
                  {c.cohort}
                </td>
                <td data-label="학과">{c.track || '-'}</td>
                <td data-label="가져온 방법">{METHOD_LABEL[c.method] ?? c.method}</td>
                <td data-label="저장" className="num">
                  {dateTime(c.createdAt, false)}
                </td>
                <td data-label="상태">
                  <div className="badges">
                    {c.verified && <span className="badge is-ok">확인됨</span>}
                    {c.hidden && <span className="badge">숨김</span>}
                    {c.openReports > 0 && <span className="badge is-warn">신고 {c.openReports}</span>}
                    {!c.verified && !c.hidden && !c.openReports && <span className="muted">-</span>}
                  </div>
                </td>
                <td className="row-actions">
                  <button type="button" className="btn btn-sm" onClick={() => setOpen(c.id)}>
                    보기
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data && !list.data.items.length && <p className="empty-table">조건에 맞는 편제표가 없어요.</p>}
        {!list.data && !list.error && <p className="empty-table">불러오는 중</p>}
      </div>
      {list.data && <Pager total={list.data.total} offset={offset} page={list.data.page} onChange={setOffset} />}
      <CurriculumDialog id={open} onClose={() => setOpen(null)} onChanged={list.reload} />
    </div>
  )
}
