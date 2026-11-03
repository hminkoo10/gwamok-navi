import { useMemo, useState } from 'react'
import type { TermId } from '../data/schema'
import { lockedBy } from '../engine/choices'
import type { Plan } from '../engine/plan'
import { type FieldScore, isSuggestible } from '../engine/suggest'
import { norm } from '../engine/search'
import { TERM_LABEL } from '../lib/format'
import { IconPin } from './icons'

interface Props {
  plan: Plan
  scores: Map<string, FieldScore>
  onTogglePin: (subject: string) => void
  onToggleExclude: (subject: string) => void
}

interface Choice {
  subject: string
  term: TermId
  where: string
}

/** 학교 편제표에서 고를 수 있는 과목을 찾아 바로 넣거나 빼기 (선택 칸·두 학기 세트) */
export function SubjectPicker({ plan, scores, onTogglePin, onToggleExclude }: Props) {
  const [query, setQuery] = useState('')
  const choices = useMemo(() => {
    const out: Choice[] = []
    const seen = new Set<string>()
    for (const g of plan.groups)
      for (const o of g.group.options) {
        if (seen.has(o)) continue
        seen.add(o)
        out.push({ subject: o, term: g.term, where: `${TERM_LABEL[g.term]} ${g.group.label}` })
      }
    for (const t of plan.tracks)
      for (const set of t.track.sets)
        for (const it of set.items) {
          if (seen.has(it.subject)) continue
          seen.add(it.subject)
          out.push({ subject: it.subject, term: it.term, where: `${TERM_LABEL[it.term]} ${t.track.label}` })
        }
    return out
  }, [plan])

  // 같은 두 학기 세트 과목을 빼서 함께 빠진 과목 (세트는 통째로 들음)
  const locked = useMemo(() => lockedBy(plan.school, plan.excluded), [plan])
  const q = norm(query)
  const status = (s: string) => (plan.pinned.has(s) ? 'pin' : plan.excluded.has(s) ? 'out' : locked.has(s) ? 'locked' : plan.taken.has(s) ? 'on' : 'off')
  const listed = (q ? choices.filter((c) => norm(c.subject).includes(q)) : choices).slice().sort((a, b) => {
    // 내가 바꾼 과목 → 추천에 든 과목 → 진로와 가까운 과목 순
    const rank = (c: Choice) => ({ pin: 0, out: 1, locked: 1, on: 2, off: 3 })[status(c.subject)]
    return rank(a) - rank(b) || (scores.get(b.subject)?.score ?? 0) - (scores.get(a.subject)?.score ?? 0) || a.subject.localeCompare(b.subject, 'ko')
  })
  const shown = q ? listed : listed.slice(0, 24)

  return (
    <details className="picker no-print">
      <summary>
        원하는 과목 직접 고르기
        {plan.pinned.size > 0 && <span className="picker-count">꼭 듣기 {plan.pinned.size}</span>}
      </summary>
      <div className="picker-body">
        <p className="picker-help">
          넣기를 누르면 그 과목이 들어갈 칸에 먼저 자리를 잡고, 남은 칸은 추천이 다시 채워요. 빼기를 누르면 추천에서 빠져요. 모두 듣는 과목은 여기 없어요.
        </p>
        <input
          type="search"
          className="input picker-search"
          placeholder="과목 이름으로 찾기 (예: 기하, 일본어)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="고를 과목 찾기"
        />
        <ul className="picker-list">
          {shown.map((c) => {
            const st = status(c.subject)
            const f = scores.get(c.subject)
            return (
              <li key={c.subject} className={`picker-row is-${st}`}>
                <div className="picker-main">
                  <span className="picker-name">
                    {st === 'pin' && <IconPin />}
                    {c.subject}
                  </span>
                  <span className="picker-meta">
                    {c.where}
                    {st === 'on' && ' · 추천에 들어 있음'}
                    {st === 'locked' && ` · 같은 세트의 ${locked.get(c.subject)?.join(', ')}을(를) 빼서 함께 빠져 있어요`}
                    {st === 'off' && isSuggestible(f) && (f.prior ? ' · 진로와 가까운 과목' : ` · 같은 분야 ${f.named}곳이 권함`)}
                  </span>
                </div>
                <button
                  type="button"
                  className={`btn btn-sm${st === 'pin' ? ' btn-primary' : ''}`}
                  aria-pressed={st === 'pin'}
                  onClick={() => onTogglePin(c.subject)}
                >
                  {st === 'pin' ? '꼭 듣기' : '넣기'}
                </button>
                <button type="button" className="btn btn-sm" aria-pressed={st === 'out'} onClick={() => onToggleExclude(c.subject)}>
                  {st === 'out' ? '다시 넣기' : '빼기'}
                </button>
              </li>
            )
          })}
        </ul>
        {!q && listed.length > shown.length && <p className="muted small">과목이 {listed.length}개예요. 이름으로 찾으면 모두 볼 수 있어요.</p>}
        {q && !listed.length && <p className="muted small">이 학교 선택 칸에는 그 이름의 과목이 없어요.</p>}
      </div>
    </details>
  )
}
