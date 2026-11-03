import { useMemo, useState } from 'react'
import { UNIT_COUNT, UNITS } from '../data/units'
import { UNIV_BY_ID, UNIVERSITIES } from '../data/universities'
import { sidoOf } from '../engine/admissions'
import { norm, unitsOf } from '../engine/search'
import { useApp } from '../lib/app'
import { COVERAGE_LABEL, REGIONS } from '../lib/format'
import { FLAGSHIP, SEOUL_MAJOR } from '../lib/store'
import { IconClose, IconSearch } from './icons'

/** 목표 대학 고르기 (시작하기 3단계) */
export function UnivSelect() {
  const { store } = useApp()
  const { majors, univs } = store.prefs
  const [query, setQuery] = useState('')
  const [region, setRegion] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [showSilent, setShowSilent] = useState(false)

  // 고른 분야(묶음·세부 학과)의 학과가 대학마다 몇 개인지
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    const units = majors.length ? [...new Map(majors.flatMap((id) => unitsOf(id)).map((u) => [u.id, u])).values()] : UNITS
    for (const u of units) m.set(u.univ, (m.get(u.univ) ?? 0) + 1)
    return m
  }, [majors])

  const q = norm(query)
  const regionSet = REGIONS.find(([label]) => label === region)?.[1]
  const list = UNIVERSITIES.filter((u) => (!regionSet || regionSet.includes(u.region)) && (!q || norm(u.name).includes(q) || norm(u.short).includes(q)))
  const relevant = list.filter((u) => counts.get(u.id))
  const others = list.filter((u) => !counts.get(u.id) && UNIT_COUNT.get(u.id))
  // 학과별 권장과목 자료가 아예 없는 대학 (권장과목을 밝히지 않았거나 찾지 못한 곳). 담아도 과목 추천은 바뀌지 않는다
  const silent = list.filter((u) => !UNIT_COUNT.get(u.id))
  const add = (ids: string[]) => store.setUnivs([...univs, ...ids.filter((id) => counts.get(id))])
  // 우리 학교가 있는 권역의 대학 (지방 대학은 지역인재 전형으로 그 지역 학생을 따로 뽑는 경우가 많다)
  const home = REGIONS.find(([, list]) => list.includes(sidoOf(store.school?.region)))
  const homeIds = home ? UNIVERSITIES.filter((u) => home[1].includes(u.region) && counts.get(u.id)).map((u) => u.id) : []

  const row = (u: (typeof UNIVERSITIES)[number]) => {
    const on = univs.includes(u.id)
    const n = counts.get(u.id) ?? 0
    return (
      <li key={u.id}>
        <label className={`pick-row${on ? ' is-on' : ''}${n ? '' : ' is-dim'}`}>
          <input type="checkbox" checked={on} onChange={() => store.toggleUniv(u.id)} />
          <span className="pick-name">{u.name}</span>
          <span className="pick-meta">
            {u.region}
            {u.coverage !== 'official' && <> · {COVERAGE_LABEL[u.coverage]}</>}
          </span>
          <span className="pick-count num">{n ? `학과 ${n}` : UNIT_COUNT.get(u.id) ? '해당 학과 없음' : '권장과목 자료 없음'}</span>
        </label>
      </li>
    )
  }

  return (
    <div className="univ-select">
      {univs.length > 0 && (
        <div className="chosen" aria-label="고른 대학">
          {univs.map((id) => {
            const u = UNIV_BY_ID.get(id)
            if (!u) return null
            return (
              <span key={id} className="chip is-on chip-x">
                {u.short}
                <button type="button" onClick={() => store.toggleUniv(id)} aria-label={`${u.short} 빼기`}>
                  <IconClose />
                </button>
              </span>
            )
          })}
          <button type="button" className="btn-link" onClick={() => store.setUnivs([])}>
            모두 빼기
          </button>
        </div>
      )}

      <div className="search">
        <IconSearch className="search-icon" />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="대학 이름" aria-label="대학 이름 검색" autoComplete="off" />
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
      <div className="row-btns">
        <button type="button" className="btn btn-sm" onClick={() => add(SEOUL_MAJOR)}>
          서울 주요 7곳 담기
        </button>
        <button type="button" className="btn btn-sm" onClick={() => add(FLAGSHIP)}>
          지역 거점 국립대 담기
        </button>
        {home && homeIds.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={() => add(homeIds)}>
            우리 지역({home[0]}) {homeIds.length}곳 담기
          </button>
        )}
      </div>

      <ul className="pick-list">{relevant.map(row)}</ul>
      {!relevant.length && <p className="hint">이 조건에 맞는 대학이 없어요.</p>}
      {others.length > 0 && (
        <>
          <button type="button" className="btn-link" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
            {showAll ? '해당 학과가 없는 대학 숨기기' : `고른 분야 학과가 없는 대학 ${others.length}곳 보기`}
          </button>
          {showAll && <ul className="pick-list">{others.map(row)}</ul>}
        </>
      )}
      {silent.length > 0 && (
        <>
          <button type="button" className="btn-link" onClick={() => setShowSilent(!showSilent)} aria-expanded={showSilent}>
            {showSilent ? '권장과목 자료가 없는 대학 숨기기' : `권장과목 자료가 없는 대학 ${silent.length}곳 보기`}
          </button>
          {showSilent && (
            <>
              <p className="hint">2028학년도 학과별 권장과목을 밝히지 않았거나 공식 자료를 찾지 못한 대학이에요. 담아도 과목 추천은 바뀌지 않아요.</p>
              <ul className="pick-list">{silent.map(row)}</ul>
            </>
          )}
        </>
      )}
    </div>
  )
}
