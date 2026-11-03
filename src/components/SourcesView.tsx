import { useState } from 'react'
import type { School } from '../data/schema'
import { EXCLUDED_NOTE, UNIVERSITIES } from '../data/universities'
import { ApiError, reportCurriculum } from '../lib/api'
import { COVERAGE_LABEL } from '../lib/format'

interface Props {
  univIds: Set<string>
  school: School
}

/** 자동으로 읽은 편제표가 틀렸을 때 알리기 (공유 편제표만) */
function Report({ id }: { id: number }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done' | string>('idle')
  if (state === 'done') return <p className="muted small">알려 주셔서 고마워요. 확인 후 고칠게요.</p>
  if (!open)
    return (
      <button type="button" className="btn-link" onClick={() => setOpen(true)}>
        틀린 곳 알리기
      </button>
    )
  return (
    <form
      className="report"
      onSubmit={(e) => {
        e.preventDefault()
        if (!text.trim()) return
        setState('sending')
        reportCurriculum(id, text.trim())
          .then(() => setState('done'))
          .catch((err) => setState(err instanceof ApiError ? err.message : '보내지 못했어요.'))
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={300}
        rows={2}
        placeholder="예: 2학년 1학기 탐구 선택이 택3이 아니라 택2예요"
        aria-label="틀린 곳"
      />
      <div className="row-btns">
        <button type="submit" className="btn btn-sm" disabled={state === 'sending' || !text.trim()}>
          보내기
        </button>
        {state !== 'idle' && state !== 'sending' && <span className="hint is-warn">{state}</span>}
      </div>
    </form>
  )
}

export function SourcesView({ univIds, school }: Props) {
  const list = UNIVERSITIES.filter((u) => univIds.size === 0 || univIds.has(u.id))

  return (
    <div className="sources">
      <p className="src-legend">
        <span>
          <span className="dot cov-official" /> 공식 자료: 대교협 자료집이나 대학 입학처 원문을 옮김
        </span>
        {list.some((u) => u.coverage === 'secondary') && (
          <span>
            <span className="dot cov-secondary" /> 2차 자료: 정리표를 옮김
          </span>
        )}
        {list.some((u) => u.coverage === 'summary') && (
          <span>
            <span className="dot cov-summary" /> 언론 요약: 기사에 나온 기준만
          </span>
        )}
      </p>

      <div className="src-list">
        {list.map((u) => (
          <article key={u.id} className="src">
            <h3>
              <span className={`dot cov-${u.coverage}`} /> {u.name}
              <span className="src-cov">{COVERAGE_LABEL[u.coverage]}</span>
            </h3>
            <p>{u.policy}</p>
            {u.caveat && <p className="src-caveat">{u.caveat}</p>}
            <ul>
              {u.sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer noopener">
                    {s.title}
                  </a>
                  {s.date ? <span className="muted"> · {s.date}</span> : null}
                </li>
              ))}
            </ul>
            <p className="muted small">확인 {u.checked}</p>
          </article>
        ))}

        <article className="src">
          <h3>
            {school.name} {school.cohort}학년도 입학생 편제표
          </h3>
          <ul>
            <li>
              {school.source.url ? (
                <a href={school.source.url} target="_blank" rel="noreferrer noopener">
                  {school.source.title}
                </a>
              ) : (
                school.source.title
              )}
            </li>
            {school.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <p className="muted small">
            {school.shared
              ? school.shared.verified
                ? `원문과 맞춰 본 편제표 · ${school.shared.at.slice(0, 10)}`
                : `자동으로 읽음 ${school.shared.at.slice(0, 10)} · 생성형 AI가 옮긴 표라 틀릴 수 있어요`
              : `확인 ${school.checked}`}
          </p>
          {school.shared && <Report id={school.shared.id} />}
        </article>
      </div>

      <p className="muted small">{EXCLUDED_NOTE}</p>
    </div>
  )
}
