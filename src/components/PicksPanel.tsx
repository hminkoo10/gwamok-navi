import { useMemo, useState } from 'react'
import { UNIV_BY_ID } from '../data/universities'
import { contextOf, STATUS_LABEL, TYPE_LABEL } from '../engine/admissions'
import { JEONGSI_LIMIT, summarizePicks, SUSI_LIMIT } from '../engine/picks'
import { useAdmissions } from '../lib/admissions'
import { useApp } from '../lib/app'
import { type MySeats, mySeatsIn, mySeatsText, myUnitsAt, recruitsMine, useUnitSeats } from '../lib/selection'
import { picksText } from '../lib/export'
import { copyText } from '../lib/clipboard'
import { CopyDialog } from './CopyDialog'
import { Link } from './Link'

const PERIODS = ['수시', '정시', '기타'] as const

/**
 * 원서 후보: 담아 둔 전형을 모집 시기별로 보고 지원 횟수·준비할 것을 확인한다.
 * aside: 넓은 화면 오른쪽 판 (목록을 늘 펼침). inline: 목록 위 판 (길면 접어 둠).
 */
export function PicksPanel({ variant = 'inline' }: { variant?: 'aside' | 'inline' }) {
  const { store, notify } = useApp()
  const { prefs, school } = store
  const data = useAdmissions()
  const ctx = useMemo(() => contextOf(prefs.profile, school), [prefs.profile, school])
  const s = useMemo(() => summarizePicks(prefs.picks, data.byUniv, ctx), [prefs.picks, data.byUniv, ctx])
  const short = (univ: string) => UNIV_BY_ID.get(univ)?.short ?? univ
  const seats = useUnitSeats()
  /** 이 전형으로 내 학과를 몇 명 뽑는지 (학과별 인원표가 있는 대학만) */
  const mySeats = (univ: string, track: string): MySeats | null => mySeatsIn(seats?.[univ], myUnitsAt(univ, prefs.majors, prefs.unitIds), track)
  const [open, setOpen] = useState(() => prefs.picks.length <= 4)
  /** 자동 복사가 막혔을 때 직접 복사하도록 띄울 글 */
  const [manualCopy, setManualCopy] = useState<string | null>(null)
  const showList = variant === 'aside' || open
  const cls = `panel-card picks is-${variant}`

  if (!prefs.picks.length)
    return (
      <section className={`${cls} is-empty`}>
        <h2 className="card-title">내 원서 후보</h2>
        <p className="muted">
          전형 오른쪽의 <strong>담기</strong>를 누르면 여기에 모여요. 수시 {SUSI_LIMIT}장, 정시 {JEONGSI_LIMIT}장을 미리 짜 보세요.
        </p>
      </section>
    )

  // 여러 줄이라 prompt()로는 줄바꿈이 사라짐. 복사가 막히면 직접 복사 창
  const copy = async () => {
    const text = picksText(s)
    if (await copyText(text)) notify('원서 후보 목록을 복사했어요.')
    else setManualCopy(text)
  }

  const needs = [
    s.needs.min && `수능 최저 ${s.needs.min}개`,
    s.needs.interview && `면접 ${s.needs.interview}개`,
    s.needs.essay && `논술 ${s.needs.essay}개`,
    s.needs.practical && `실기 ${s.needs.practical}개`,
  ].filter(Boolean)
  const ready = !data.loading && !data.error

  return (
    <section className={cls}>
      <div className="card-head">
        <h2 className="card-title">내 원서 후보</h2>
        <div className="picks-actions">
          {ready && s.items.length > 0 && (
            <button type="button" className="btn-link" onClick={copy}>
              목록 복사
            </button>
          )}
          {variant === 'inline' && s.items.length > 0 && (
            <button type="button" className="btn-link" onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? '접기' : `펼치기 (${s.items.length})`}
            </button>
          )}
        </div>
      </div>
      <p className="picks-count">
        <span className={s.count.수시 > SUSI_LIMIT ? 'is-over' : ''}>
          수시 <strong className="num">{s.count.수시}</strong>/{SUSI_LIMIT}
        </span>
        <span className={s.count.정시 > JEONGSI_LIMIT ? 'is-over' : ''}>
          정시 <strong className="num">{s.count.정시}</strong>/{JEONGSI_LIMIT}
        </span>
        {s.count.기타 > 0 && (
          <span>
            기타 <strong className="num">{s.count.기타}</strong>
          </span>
        )}
      </p>

      {data.loading && <p className="progress-line muted">전형 자료를 불러오는 중</p>}
      {data.error && <p className="form-error">{data.error}</p>}

      {ready && (
        <>
          {(s.count.수시 > SUSI_LIMIT || s.count.정시 > JEONGSI_LIMIT || s.blocked > 0 || s.sameUniv.length > 0 || s.missing.length > 0) && (
            <ul className="picks-warn">
              {s.count.수시 > SUSI_LIMIT && (
                <li>
                  수시는 {SUSI_LIMIT}번까지 지원할 수 있어요. {s.count.수시 - SUSI_LIMIT}개를 줄여야 해요.
                </li>
              )}
              {s.count.정시 > JEONGSI_LIMIT && (
                <li>정시는 가·나·다군에 한 번씩, {JEONGSI_LIMIT}번까지예요. 대학·학과마다 군이 다르니 모집요강에서 확인하세요.</li>
              )}
              {s.blocked > 0 && <li>지금 조건으로는 지원할 수 없는 전형이 {s.blocked}개 있어요.</li>}
              {s.sameUniv.map((g) => (
                <li key={g.univ}>
                  {short(g.univ)} 수시 전형을 {g.names.length}개 담았어요.{' '}
                  {g.notes.length ? g.notes.join(' / ') : '같은 대학 안에서 중복 지원이 되는지 모집요강에서 확인하세요.'}
                </li>
              ))}
              {s.missing.length > 0 && (
                <li>
                  지금 자료에서 찾을 수 없는 전형이 {s.missing.length}개 있어요. 대학이 전형을 바꿨을 수 있어요.{' '}
                  <button type="button" className="btn-link" onClick={() => store.removePicks(s.missing)}>
                    목록에서 빼기
                  </button>
                </li>
              )}
            </ul>
          )}

          {PERIODS.map((period) => {
            const list = showList ? s.items.filter((it) => it.track.period === period) : []
            if (!list.length) return null
            return (
              <div key={period} className="picks-group">
                <h3 className="picks-period">{period}</h3>
                <ol className="picks-list">
                  {list.map((it) => {
                    const t = it.track
                    return (
                      <li key={it.key} className={`cand-row is-${it.result.status}`}>
                        <span className={`adm-badge is-${it.result.status}`}>{STATUS_LABEL[it.result.status]}</span>
                        <div className="cand-main">
                          <p className="cand-name">
                            <Link to={`/universities/${it.plan.univ}`}>{short(it.plan.univ)}</Link> {t.name}
                          </p>
                          <p className="cand-meta">
                            {t.type === '수능' ? '수능' : TYPE_LABEL[t.type]} · {t.elements.join('·')} · 수능 최저 {t.min ? '있음' : '없음'}
                            {t.seats !== null ? ` · ${t.seats.toLocaleString('ko-KR')}명` : ''}
                            {(() => {
                              const my = mySeats(it.plan.univ, t.id)
                              return !my ? null : my.total ? (
                                <b className="my-seats"> · {mySeatsText(my)}</b>
                              ) : (
                                <span className={`my-seats${recruitsMine(my) ? '' : ' is-none'}`}> · {mySeatsText(my)}</span>
                              )
                            })()}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="btn-link cand-remove"
                          onClick={() => store.removePicks([it.key])}
                          aria-label={`${short(it.plan.univ)} ${t.name} 빼기`}
                        >
                          빼기
                        </button>
                      </li>
                    )
                  })}
                </ol>
              </div>
            )
          })}

          {needs.length > 0 && <p className="picks-needs">준비할 것: {needs.join(' · ')}</p>}
        </>
      )}

      <p className="fine">
        수시에 합격하면 등록하지 않아도 그해 정시·추가모집에 지원할 수 없어요. 과학기술원·사관학교·경찰대학 같은 특별법 대학과 산업대·전문대는 지원 횟수에
        들어가지 않아요.
      </p>
      {manualCopy !== null && <CopyDialog text={manualCopy} onClose={() => setManualCopy(null)} />}
    </section>
  )
}
