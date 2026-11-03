import { Fragment } from 'react'
import { TERMS } from '../data/schema'
import type { Plan, Reason } from '../engine/plan'
import type { Suggestion } from '../engine/suggest'
import { josa, setWhyText, TERM_LABEL, unitLabel } from '../lib/format'

interface Row {
  key: string
  slot: string
  subject: string
  why: string
  kind: 'auto' | 'pin' | 'free'
}

/** 과목마다 왜 들어갔는지 한 줄로 */
function whyOf(r: Reason | undefined): string {
  if (!r) return ''
  if (r.units.length) {
    const names = r.units.map(unitLabel)
    return `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` 외 ${names.length - 3}곳` : ''} 권장`
  }
  if (r.before.length) {
    const next = r.before.join(', ')
    return `${next}${josa(next, '을', '를')} 듣기 전에 들으면 좋은 과목`
  }
  return r.pinned ? '내가 꼭 듣기로 함' : ''
}

/** 자동으로 고른 과목과 직접 고를 칸을 학기 순서로 정리한 표 */
export function ChosenList({
  plan,
  reasons,
  suggestions,
  onSubject,
}: {
  plan: Plan
  reasons: Map<string, Reason>
  suggestions: Map<string, Suggestion[]>
  onSubject: (subject: string) => void
}) {
  const byTerm = TERMS.map((term) => {
    const rows: Row[] = []
    for (const g of plan.groups.filter((x) => x.term === term)) {
      for (const s of g.chosen) {
        const r = reasons.get(s)
        rows.push({ key: `${g.group.id}-${s}`, slot: g.group.label, subject: s, why: whyOf(r), kind: plan.pinned.has(s) ? 'pin' : 'auto' })
      }
      if (g.free) {
        const hints = (suggestions.get(g.group.id) ?? []).slice(0, Math.max(g.free, 2)).map((x) => x.subject)
        rows.push({
          key: `${g.group.id}-free`,
          slot: g.group.label,
          subject: `고를 칸 ${g.free}개`,
          why: hints.length
            ? `추천: ${hints.join(', ')}. 전국의 같은 분야 학과들이 많이 권하거나 진로와 가까운 과목이에요.`
            : '목표 학과 권장과목과 관계없는 칸이에요. 관심 있는 과목을 고르세요.',
          kind: 'free',
        })
      }
    }
    for (const t of plan.tracks) {
      if (t.setIndex === null) continue
      for (const it of t.track.sets[t.setIndex].items.filter((x) => x.term === term)) {
        const pinned = plan.pinned.has(it.subject)
        rows.push({
          key: `${t.track.id}-${it.subject}`,
          slot: t.track.label,
          subject: it.subject,
          why: whyOf(reasons.get(it.subject)) || setWhyText(plan, t),
          kind: pinned ? 'pin' : 'auto',
        })
      }
    }
    return { term, rows }
  }).filter((x) => x.rows.length)

  const auto = byTerm.reduce((n, t) => n + t.rows.filter((r) => r.kind === 'auto').length, 0)
  const free = byTerm.reduce((n, t) => n + t.rows.filter((r) => r.kind === 'free').length, 0)
  if (!byTerm.length) return null

  return (
    <section className="auto-picks" aria-label="자동으로 고른 과목">
      <h3 className="auto-picks-title">
        자동으로 고른 과목 <span className="num">{auto}</span>
        {free > 0 && (
          <span className="muted">
            {' '}
            · 직접 고를 칸 <span className="num">{free}</span>
          </span>
        )}
      </h3>
      <p className="auto-picks-help">
        고른 학과의 권장과목을 채우려고 선택 칸마다 자동으로 고른 과목이에요. 학교 수강 신청 때 이대로 고르면 돼요. 다른 과목으로 바꾸려면 과목 이름을 눌러
        빼거나, 칸을 눌러 다른 과목을 꼭 듣기로 하세요.
      </p>
      <div className="table-wrap">
        <table className="table auto-picks-table">
          <thead>
            <tr>
              <th>학기</th>
              <th>선택 칸</th>
              <th>과목</th>
              <th>고른 이유</th>
            </tr>
          </thead>
          <tbody>
            {byTerm.map(({ term, rows }) => (
              <Fragment key={term}>
                {rows.map((r, i) => (
                  <tr key={r.key} className={`is-${r.kind}`}>
                    <td data-label="학기">{i === 0 ? TERM_LABEL[term] : ''}</td>
                    <td data-label="선택 칸">{r.slot}</td>
                    <td data-label="과목">
                      {r.kind === 'free' ? (
                        <span className="muted">{r.subject}</span>
                      ) : (
                        <button type="button" className="inline-link" onClick={() => onSubject(r.subject)}>
                          {r.subject}
                        </button>
                      )}
                      {r.kind === 'pin' && <span className="pill">꼭 듣기</span>}
                    </td>
                    <td data-label="고른 이유">{r.why}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
