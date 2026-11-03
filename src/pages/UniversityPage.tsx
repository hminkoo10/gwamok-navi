import { useMemo, useState } from 'react'
import { smoothly } from '../lib/motion'
import { IconSearch } from '../components/icons'
import { MAJOR_BY_ID } from '../data/majors'
import { UNITS } from '../data/units'
import { UNIV_BY_ID } from '../data/universities'
import { makePlan } from '../engine/plan'
import { fineOf, norm } from '../engine/search'
import { shortSchool, useApp } from '../lib/app'
import { clauseText, COVERAGE_LABEL } from '../lib/format'
import { Link } from '../components/Link'
import { UnivAdmissions } from '../components/UnivAdmissions'
import { NotFoundPage } from './NotFoundPage'

export function UniversityPage({ id }: { id: string }) {
  const { store } = useApp()
  const univ = UNIV_BY_ID.get(id)
  const units = useMemo(() => UNITS.filter((u) => u.univ === id), [id])
  const school = store.school
  // 고른 학교 편제표로 학과마다 권장과목을 다 들을 수 있는지 미리 계산
  const fit = useMemo(() => {
    const out = new Map<string, { ok: boolean; notOffered: string[]; noSlot: string[] }>()
    if (!school) return out
    for (const u of units) {
      if (!u.clauses.length) continue
      const r = makePlan(school, [u]).units[0]
      const missing = r.clauses.filter((c) => !c.ok).flatMap((c) => c.missing)
      const of = (reason: string) => [...new Set(missing.filter((m) => m.reason === reason).map((m) => m.subject))]
      out.set(u.id, { ok: r.ok, notOffered: of('not-offered'), noSlot: of('no-slot') })
    }
    return out
  }, [school, units])
  const [onlyFit, setOnlyFit] = useState(false)
  const [query, setQuery] = useState('')
  const [field, setField] = useState('')
  const [view, setView] = useState<'units' | 'admissions'>('units')
  if (!univ) return <NotFoundPage />

  const fields = [...new Set(units.flatMap((u) => u.majors))].filter((m) => MAJOR_BY_ID.has(m))
  const q = norm(query)
  const list = units.filter((u) => (!field || u.majors.includes(field)) && (!q || norm(u.name).includes(q)) && (!onlyFit || fit.get(u.id)?.ok !== false))
  const fitCount = [...fit.values()].filter((f) => f.ok).length
  const on = store.prefs.univs.includes(univ.id)

  return (
    <div className="wrap page">
      <nav className="crumbs" aria-label="위치">
        <Link to="/universities">대학 권장과목</Link>
        <span aria-hidden="true">/</span>
        <span>{univ.name}</span>
      </nav>
      <header className="page-head univ-head">
        <div>
          <h1 className="page-title">{univ.name}</h1>
          <p className="page-sub">
            {univ.region} · 학과 {units.length} · {COVERAGE_LABEL[univ.coverage]}
          </p>
        </div>
        <button type="button" className={`btn${on ? ' btn-primary' : ''}`} aria-pressed={on} onClick={() => store.toggleUniv(univ.id)}>
          {on ? '목표 대학에 담음' : '목표 대학에 담기'}
        </button>
      </header>

      <div className="tabs" role="tablist" aria-label="보기">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'units'}
          className={view === 'units' ? 'is-on' : ''}
          onClick={() => smoothly(() => setView('units'))}
        >
          학과별 권장과목
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'admissions'}
          className={view === 'admissions' ? 'is-on' : ''}
          onClick={() => smoothly(() => setView('admissions'))}
        >
          2028 전형
        </button>
      </div>

      {view === 'admissions' ? (
        <UnivAdmissions univ={univ.id} />
      ) : (
        <>
          <section className="univ-info">
            <p>{univ.policy}</p>
            {univ.caveat && <p className="cond-flag">{univ.caveat}</p>}
            <ul className="src-links">
              {univ.sources.map((s) => (
                <li key={s.url + s.title}>
                  <a href={s.url} target="_blank" rel="noreferrer noopener">
                    {s.title}
                  </a>
                  {s.date && <span className="muted"> · {s.date}</span>}
                </li>
              ))}
            </ul>
          </section>

          <div className="filter-bar">
            <div className="search">
              <IconSearch className="search-icon" />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="학과 이름" aria-label="학과 이름" />
            </div>
            {school && fit.size > 0 && (
              <label className="switch">
                <input type="checkbox" checked={onlyFit} onChange={(e) => setOnlyFit(e.target.checked)} />
                {shortSchool(school.name)}에서 다 들을 수 있는 학과만
              </label>
            )}
          </div>
          {school && fit.size > 0 && (
            <p className="hint">
              {shortSchool(school.name)} {school.cohort}학년도 입학 편제표로 보면, 과목 조건이 있는 학과 {fit.size}곳 중 {fitCount}곳의 권장과목을 다 들을 수
              있어요.
            </p>
          )}
          {fields.length > 1 && (
            <div className="chips" role="group" aria-label="분야">
              <button type="button" className={`chip${!field ? ' is-on' : ''}`} onClick={() => setField('')}>
                전체
              </button>
              {fields.map((m) => (
                <button key={m} type="button" className={`chip${field === m ? ' is-on' : ''}`} aria-pressed={field === m} onClick={() => setField(m)}>
                  {MAJOR_BY_ID.get(m)?.name}
                </button>
              ))}
            </div>
          )}

          <ul className="unit-table">
            {list.map((u) => (
              <li key={u.id} className="unit-row">
                <div className="unit-row-name">
                  <strong>{u.name}</strong>
                  <span className="muted">{(fineOf(u).length ? fineOf(u) : u.majors).map((m) => MAJOR_BY_ID.get(m)?.name).join(', ')}</span>
                </div>
                <div className="unit-row-body">
                  {school && fit.has(u.id) && <FitLine fit={fit.get(u.id)!} school={shortSchool(school.name)} />}
                  {(u.core || u.rec) && norm(`${u.core ?? ''}${u.rec ?? ''}`) !== norm(u.clauses.map(clauseText).join('')) && (
                    <dl className="cond-src">
                      {u.merged ? (
                        <div>
                          <dt>원문</dt>
                          <dd>{u.core}</dd>
                        </div>
                      ) : (
                        <>
                          {u.core && (
                            <div>
                              <dt>핵심과목</dt>
                              <dd>{u.core}</dd>
                            </div>
                          )}
                          {u.rec && (
                            <div>
                              <dt>권장과목</dt>
                              <dd>{u.rec}</dd>
                            </div>
                          )}
                        </>
                      )}
                    </dl>
                  )}
                  {u.clauses.length ? (
                    <ul className="clause-list">
                      {u.clauses.map((c, i) => (
                        <li key={i}>
                          {c.level === 'core' && <span className="pill">핵심</span>}
                          {clauseText(c)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">따로 정한 과목이 없어요.</p>
                  )}
                  {u.note && <p className="cond-note">{u.note}</p>}
                  {(u.check || u.legacy) && <p className="cond-flag">원문 해석이 애매한 칸이 있어요. 대학 입학처 안내를 함께 확인하세요.</p>}
                </div>
              </li>
            ))}
          </ul>
          {!list.length && <p className="hint">조건에 맞는 학과가 없어요.</p>}
        </>
      )}
    </div>
  )
}

/** 고른 학교에서 이 학과 권장과목을 다 들을 수 있는지 한 줄로 */
function FitLine({ fit, school }: { fit: { ok: boolean; notOffered: string[]; noSlot: string[] }; school: string }) {
  if (fit.ok) return <p className="fit is-ok">{school}에서 권장과목을 다 들을 수 있어요</p>
  return (
    <p className="fit is-warn">
      {fit.notOffered.length > 0 && `${school} 편제표에 없는 과목: ${fit.notOffered.join(', ')}`}
      {fit.notOffered.length > 0 && fit.noSlot.length > 0 && ' · '}
      {fit.noSlot.length > 0 && `선택 칸이 겹쳐 같이 못 듣는 과목: ${fit.noSlot.join(', ')}`}
    </p>
  )
}
