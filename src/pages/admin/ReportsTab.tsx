import { useState } from 'react'
import { Pager } from '../../components/Pager'
import { adminApi } from '../../lib/admin'
import { ApiError } from '../../lib/api'
import { useApp } from '../../lib/app'
import { dateTime } from '../../lib/format'
import { useLoad } from '../../lib/hooks'
import { CurriculumDialog } from './CurriculaTab'

const STATUS: [string, string][] = [
  ['open', '처리 안 한 것'],
  ['resolved', '처리한 것'],
  ['all', '모두'],
]

export function ReportsTab() {
  const { notify } = useApp()
  const [status, setStatus] = useState('open')
  const [offset, setOffset] = useState(0)
  const [open, setOpen] = useState<number | null>(null)
  const list = useLoad(() => adminApi.reports({ status, offset }), `${status}|${offset}`)

  const resolve = async (id: number, resolved: boolean) => {
    try {
      await adminApi.updateReport(id, resolved)
      notify(resolved ? '처리했어요.' : '다시 열었어요.')
      list.reload()
    } catch (err) {
      notify(err instanceof ApiError ? err.message : '바꾸지 못했어요.')
    }
  }

  return (
    <div className="admin-reports">
      <div className="admin-toolbar">
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
      <p className="hint">학생들이 출처 탭에서 '틀린 곳 알리기'로 보낸 신고예요. 편제표를 원문과 비교해 고치거나 숨긴 뒤 처리해 주세요.</p>
      {list.error && <p className="form-error">{list.error}</p>}
      <ul className={`report-list${list.loading ? ' is-loading' : ''}`}>
        {list.data?.items.map((r) => (
          <li key={r.id} className={`report-item${r.resolved ? ' is-done' : ''}`}>
            <div className="report-main">
              <p className="report-school">
                <strong>{r.schoolName}</strong>
                <span className="muted">
                  {r.cohort ? ` ${r.cohort}학년도 입학` : ''}
                  {r.track ? ` · ${r.track}` : ''} · {dateTime(r.createdAt)}
                </span>
                {r.resolved && <span className="badge is-ok">처리함</span>}
              </p>
              <p className="report-reason">{r.reason}</p>
            </div>
            <div className="row-btns">
              <button type="button" className="btn btn-sm" onClick={() => setOpen(r.curriculumId)}>
                편제표 보기
              </button>
              <button type="button" className={`btn btn-sm${r.resolved ? '' : ' btn-primary'}`} onClick={() => void resolve(r.id, !r.resolved)}>
                {r.resolved ? '다시 열기' : '처리함'}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {list.data && !list.data.items.length && <p className="empty-table">{status === 'open' ? '처리할 신고가 없어요.' : '신고가 없어요.'}</p>}
      {!list.data && !list.error && <p className="empty-table">불러오는 중</p>}
      {list.data && <Pager total={list.data.total} offset={offset} page={list.data.page} onChange={setOffset} />}
      <CurriculumDialog id={open} onClose={() => setOpen(null)} onChanged={list.reload} />
    </div>
  )
}
