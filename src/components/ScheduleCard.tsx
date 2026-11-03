import { useState } from 'react'
import { admissionYearOf, daysUntil, LATEST_SCHEDULE, nextMilestone, ongoing, SCHEDULES, scheduleFor } from '../data/schedule'

const md = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`
const ymd = (d: string) => `${d.slice(0, 4)}년 ${md(d)}`
const dday = (n: number) => (n > 0 ? `D-${n}` : 'D-Day')

/** 내 학년이 보는 학년도의 대입 일정과 D-day */
export function ScheduleCard({ cohort }: { cohort?: number }) {
  const [open, setOpen] = useState(false)
  const year = cohort ? admissionYearOf(cohort) : SCHEDULES[0].year
  const mine = scheduleFor(year)
  const shown = mine ?? LATEST_SCHEDULE
  // D-day는 내 학년도 일정에만 센다 (다른 학년도 일정은 참고로만 보여 준다)
  const next = mine ? nextMilestone(mine.items) : null
  const now = mine ? ongoing(mine.items) : []

  return (
    <section className="panel-card schedule">
      <div className="card-head">
        <h2 className="card-title">{shown.year}학년도 대입 일정</h2>
        <button type="button" className="btn-link" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? '접기' : '모두 보기'}
        </button>
      </div>
      {cohort && !mine && (
        <p className="callout is-warn">
          {cohort}년 입학생은 {year}학년도 입시를 봐요.{' '}
          {year > shown.year
            ? `${year}학년도 일정은 대교협이 ${year - 2}년 8월 말에 발표해요. 아래는 지금 나와 있는 가장 늦은 ${shown.year}학년도 일정이고, 해마다 비슷한 때에 열려요.`
            : `${year}학년도 일정은 대교협 누리집에서 확인하세요. 아래는 ${shown.year}학년도 일정이에요.`}
        </p>
      )}
      {next && (
        <div className="next-milestone">
          <span className="dday num">{dday(daysUntil(next.start))}</span>
          <div>
            <strong>{next.label}</strong>
            <span className="muted">
              {ymd(next.start)}
              {next.end ? ` ~ ${md(next.end)}` : ''}
            </span>
          </div>
        </div>
      )}
      {now.length > 0 && <p className="schedule-now">지금 진행 중: {now.map((m) => `${m.label} (${md(m.end ?? m.start)}까지)`).join(', ')}</p>}
      {open && (
        <ol className="timeline">
          {shown.items.map((m) => {
            const left = mine ? daysUntil(m.end ?? m.start) : 0
            const started = mine ? daysUntil(m.start) <= 0 : false
            return (
              <li key={m.label} className={left < 0 ? 'is-past' : started ? 'is-now' : ''}>
                <span className={`tl-group is-${m.group}`}>{m.group}</span>
                <span className="tl-date num">
                  {md(m.start)}
                  {m.end ? ` ~ ${md(m.end)}` : ''}
                </span>
                <span className="tl-label">
                  {m.label}
                  {m.note && <small className="muted"> {m.note}</small>}
                </span>
              </li>
            )
          })}
        </ol>
      )}
      <p className="fine">
        출처:{' '}
        <a href={shown.source.url} target="_blank" rel="noreferrer noopener">
          {shown.source.title}
        </a>
        . 대학별 면접·논술·실기 날짜는 그 대학 모집요강에서 확인하세요.
      </p>
    </section>
  )
}
