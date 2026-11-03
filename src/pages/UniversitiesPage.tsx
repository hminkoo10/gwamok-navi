import { useMemo, useState } from 'react'
import { IconSearch } from '../components/icons'
import { REGIONS } from '../lib/format'
import { MAJORS, MAJOR_BY_ID } from '../data/majors'
import { UNIT_COUNT, UNITS } from '../data/units'
import { UNIV_BY_ID, UNIVERSITIES } from '../data/universities'
import { norm } from '../engine/search'
import { useApp } from '../lib/app'
import { clauseText, COVERAGE_LABEL } from '../lib/format'
import { Link } from '../components/Link'

export function UniversitiesPage() {
  const { store } = useApp()
  const [query, setQuery] = useState('')
  const [region, setRegion] = useState<string | null>(null)
  const [field, setField] = useState('')

  const q = norm(query)
  const regionSet = REGIONS.find(([label]) => label === region)?.[1]
  const units = useMemo(() => (field ? UNITS.filter((u) => u.majors.includes(field)) : UNITS), [field])
  const count = useMemo(() => {
    const m = new Map<string, number>()
    for (const u of units) m.set(u.univ, (m.get(u.univ) ?? 0) + 1)
    return m
  }, [units])

  const inView = (u: (typeof UNIVERSITIES)[number]) =>
    (!regionSet || regionSet.includes(u.region)) && (!q || norm(u.name).includes(q) || norm(u.short).includes(q))
  const univs = UNIVERSITIES.filter((u) => inView(u) && count.get(u.id))
  // 학과별 권장과목 자료가 없는 대학 (밝히지 않았거나 공식 자료를 못 찾음): 안내와 출처만
  const silent = UNIVERSITIES.filter((u) => inView(u) && !UNIT_COUNT.get(u.id))
  const withUnits = UNIVERSITIES.filter((u) => UNIT_COUNT.get(u.id)).length
  // 학과 이름으로 찾기
  const unitHits =
    q.length >= 2 ? units.filter((u) => norm(u.name).includes(q) && (!regionSet || regionSet.includes(UNIV_BY_ID.get(u.univ)?.region ?? ''))).slice(0, 60) : []

  return (
    <div className="wrap page">
      <header className="page-head">
        <p className="eyebrow">2028학년도</p>
        <h1 className="page-title">대학 권장과목</h1>
        <p className="page-sub">
          대학 {withUnits}곳의 학과별 핵심·권장과목이에요. 대교협 자료집과 대학 입학처 자료를 옮겼고, 원문 칸도 함께 보여 줘요. 권장과목 자료가 없는 대학{' '}
          {UNIVERSITIES.length - withUnits}곳도 무엇을 확인했는지 볼 수 있어요.
        </p>
      </header>

      <div className="filter-bar">
        <div className="search">
          <IconSearch className="search-icon" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="대학이나 학과 이름 (예: 컴퓨터, 서울대)"
            aria-label="대학이나 학과 이름"
          />
        </div>
        <select className="select" value={field} onChange={(e) => setField(e.target.value)} aria-label="분야">
          <option value="">모든 분야</option>
          {MAJORS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <div className="chips" role="group" aria-label="지역">
        <button type="button" className={`chip${region === null ? ' is-on' : ''}`} aria-pressed={region === null} onClick={() => setRegion(null)}>
          전국
        </button>
        {REGIONS.map(([label]) => (
          <button
            key={label}
            type="button"
            className={`chip${region === label ? ' is-on' : ''}`}
            aria-pressed={region === label}
            onClick={() => setRegion(label)}
          >
            {label}
          </button>
        ))}
      </div>

      {unitHits.length > 0 && (
        <section className="section-tight">
          <h2 className="section-title">학과 {unitHits.length}곳</h2>
          <ul className="unit-hits">
            {unitHits.map((u) => (
              <li key={u.id}>
                <Link to={`/universities/${u.univ}`} className="unit-hit">
                  <span className="unit-hit-name">
                    {UNIV_BY_ID.get(u.univ)?.short} {u.name}
                  </span>
                  <span className="unit-hit-req">{u.clauses.length ? u.clauses.map(clauseText).join(' · ') : '따로 정한 과목 없음'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="section-tight">
        <h2 className="section-title">
          대학 {univs.length}곳{field ? ` · ${MAJOR_BY_ID.get(field)?.name}` : ''}
        </h2>
        <ul className="univ-grid">
          {univs.map((u) => {
            const on = store.prefs.univs.includes(u.id)
            return (
              <li key={u.id} className="univ-card">
                <Link to={`/universities/${u.id}`} className="univ-card-link">
                  <strong>{u.name}</strong>
                  <span className="univ-card-meta">
                    {u.region} · 학과 {count.get(u.id)}
                    {u.coverage !== 'official' && ` · ${COVERAGE_LABEL[u.coverage]}`}
                  </span>
                </Link>
                <button type="button" className={`btn btn-sm${on ? ' btn-primary' : ''}`} aria-pressed={on} onClick={() => store.toggleUniv(u.id)}>
                  {on ? '담음' : '목표에 담기'}
                </button>
              </li>
            )
          })}
        </ul>
        {!univs.length && <p className="hint">조건에 맞는 대학이 없어요.</p>}
      </section>

      {silent.length > 0 && (
        <section className="section-tight">
          <details className="silent-univs">
            <summary>권장과목 자료가 없는 대학 {silent.length}곳</summary>
            <p className="hint">2028학년도 학과별 권장과목을 밝히지 않았거나 공식 자료를 찾지 못한 대학이에요. 대학마다 확인한 문서와 안내를 볼 수 있어요.</p>
            <ul className="univ-grid">
              {silent.map((u) => {
                const on = store.prefs.univs.includes(u.id)
                return (
                  <li key={u.id} className="univ-card">
                    <Link to={`/universities/${u.id}`} className="univ-card-link">
                      <strong>{u.name}</strong>
                      <span className="univ-card-meta">{u.region} · 권장과목 자료 없음</span>
                    </Link>
                    <button type="button" className={`btn btn-sm${on ? ' btn-primary' : ''}`} aria-pressed={on} onClick={() => store.toggleUniv(u.id)}>
                      {on ? '담음' : '목표에 담기'}
                    </button>
                  </li>
                )
              })}
            </ul>
          </details>
        </section>
      )}
    </div>
  )
}
