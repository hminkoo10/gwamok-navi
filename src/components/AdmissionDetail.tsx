import type { AdmissionPlan, RecordRule, Stage, SuneungRule } from '../data/schema'

// 전형 상세: 단계별 선발, 정시 수능 반영(영역별 비율·산출식), 학생부 반영 방법

const AREA_ORDER = ['국어', '수학', '영어', '탐구', '한국사', '직업탐구', '제2외국어/한문']

/**
 * 단계별 표에 전형 방법 글에 없는 비율이 있는지.
 * 표는 실질 반영 비율이나 세부 배점(학생부 → 교과·출결)으로 적혀 글의 명목 비율과 다를 수 있다. 반올림 차이(약 67% ↔ 66.7)는 같다고 본다
 */
function stagesDiffer(stages: Stage[], method: string): boolean {
  const named = [...method.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1]))
  if (!named.length) return false
  return stages.some((s) => Object.values(s.parts).some((v) => !named.some((n) => Math.abs(n - v) <= 1)))
}

export function StagesTable({ stages, method }: { stages: Stage[]; method?: string }) {
  const differs = method ? stagesDiffer(stages, method) : false
  return (
    <>
      <table className="mini-table stages">
        <thead>
          <tr>
            <th>단계</th>
            <th>선발</th>
            <th>반영 비율</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((s) => (
            <tr key={s.step}>
              <td>{s.step}</td>
              <td>{s.pick ?? '-'}</td>
              <td>
                <span className="parts">
                  {Object.entries(s.parts).map(([k, v]) => (
                    <span key={k} className="part">
                      {k} <b className="num">{v}%</b>
                    </span>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {differs && (
        <p className="stages-note">
          표는 대학이 밝힌 실질 반영 비율(기본점수를 빼고 실제로 점수 차이를 만드는 비율)이나 세부 배점을 따라서, 위 전형 방법에 적힌 비율과 다를 수 있어요.
        </p>
      )}
    </>
  )
}

/** 정시 수능 반영: 묶음마다 영역별 비율. 가장 많이 반영하는 영역 강조 */
export function SuneungTable({ rules, open = false, mine }: { rules: SuneungRule[]; open?: boolean; mine?: (r: SuneungRule) => boolean }) {
  const areas = AREA_ORDER.filter((a) => rules.some((r) => r.weights[a] !== undefined))
  // 내 학과가 드는 묶음을 위로 (그런 묶음이 일부일 때만)
  const marked = mine ? rules.map((r) => ({ r, on: mine(r) })) : rules.map((r) => ({ r, on: false }))
  const some = marked.some((x) => x.on) && marked.some((x) => !x.on)
  const ordered = some ? [...marked.filter((x) => x.on), ...marked.filter((x) => !x.on)] : marked
  return (
    <div className="suneung">
      <div className="table-scroll">
        <table className="mini-table weights">
          <thead>
            <tr>
              <th>묶음</th>
              {areas.length ? areas.map((a) => <th key={a}>{a}</th>) : <th>반영 방법</th>}
              <th className="use-col">활용 점수</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map(({ r, on }) => {
              const values = Object.values(r.weights)
              const max = values.length ? Math.max(...values) : 0
              return (
                <tr key={`${r.group}-${r.pages}`} className={some && on ? 'is-mine' : undefined}>
                  <td>
                    {some && on && <em className="mine-tag">내 학과</em>}
                    <b>{r.group}</b>
                    {r.units && <small className="muted unit-desc"> {r.units}</small>}
                    <small className="use-inline">{r.use}</small>
                  </td>
                  {!values.length ? (
                    // 성적 좋은 영역을 골라 반영: 정해진 비율 없음 (산출식 참고)
                    <td colSpan={Math.max(1, areas.length)} className="pick-best">
                      정해진 비율 없이 성적이 좋은 영역을 골라 반영해요. 아래 산출식을 보세요.
                    </td>
                  ) : (
                    areas.map((a) => (
                      <td key={a} className={`num${r.weights[a] === max && max > 0 ? ' is-top' : ''}`}>
                        {r.weights[a] !== undefined ? `${r.weights[a]}%` : '-'}
                      </td>
                    ))
                  )}
                  <td className="use-col">
                    {r.use}
                    {values.reduce((a, b) => a + b, 0) > 101 && (
                      <small className="best-of">비율 합이 100%를 넘어요. 영역 가운데 성적이 좋은 것만 골라 반영해요.</small>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <details className="rule-more" open={open}>
        <summary>탐구·영어·한국사 반영과 산출식</summary>
        <RuleNotes rules={rules} />
      </details>
    </div>
  )
}

const NOTE_KEYS: [keyof SuneungRule, string][] = [
  ['inquiry', '탐구'],
  ['english', '영어'],
  ['history', '한국사'],
  ['bonus', '가산점'],
  ['formula', '산출식'],
]

/** 항목마다 같은 문장은 한 번만, 묶음마다 다르면 묶음 이름을 앞에 붙임 */
function RuleNotes({ rules }: { rules: SuneungRule[] }) {
  const text = (r: SuneungRule, k: keyof SuneungRule) =>
    k === 'formula' && r.formula ? `${r.formula}${r.total ? ` (${r.total.toLocaleString('ko-KR')}점 만점)` : ''}` : (r[k] as string | null)
  return (
    <div className="rule-notes-wrap">
      <dl className="kv rule-notes">
        {NOTE_KEYS.map(([k, label]) => {
          const byText = new Map<string, string[]>()
          for (const r of rules) {
            const t = text(r, k)
            if (t) byText.set(t, [...(byText.get(t) ?? []), r.group])
          }
          if (!byText.size) return null
          return (
            <div key={k}>
              <dt>{label}</dt>
              <dd>
                {[...byText].map(([t, groups]) => (
                  <p key={t} className="rule-line">
                    {(byText.size > 1 || groups.length < rules.length) && rules.length > 1 && <b className="rule-for">{groups.join(', ')}: </b>}
                    {t}
                  </p>
                ))}
              </dd>
            </div>
          )
        })}
      </dl>
      <p className="muted small">원문 {[...new Set(rules.map((r) => r.pages))].join(', ')}쪽</p>
    </div>
  )
}

export function RecordList({ rules }: { rules: RecordRule[] }) {
  return (
    <div className="record-rules">
      {rules.map((r, i) => (
        <dl key={i} className="kv rule-notes">
          {[
            ['반영 교과', r.subjects],
            ['반영 학기', r.terms],
            ['등급 점수', r.grades],
            ['성취도 과목', r.achievement],
            ['산출식', r.formula],
            ['출결 등', r.extra],
          ]
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          <p className="muted small">원문 {r.pages}쪽</p>
        </dl>
      ))}
    </div>
  )
}

/** 대학 한 곳의 정시 수능·학생부 반영 방법 (대학 페이지 2028 전형 탭) */
export function PlanRules({ plan }: { plan: AdmissionPlan }) {
  if (!plan.suneung?.length && !plan.record?.length) return null
  return (
    <section className="plan-rules">
      {plan.suneung && plan.suneung.length > 0 && (
        <div>
          <h3 className="rules-title">정시 수능 반영 비율</h3>
          <p className="muted small">진하게 표시한 영역이 그 묶음에서 가장 많이 반영돼요.</p>
          <SuneungTable rules={plan.suneung} />
        </div>
      )}
      {plan.record && plan.record.length > 0 && (
        <div>
          <h3 className="rules-title">학생부 교과 반영 방법</h3>
          <RecordList rules={plan.record} />
        </div>
      )}
    </section>
  )
}
