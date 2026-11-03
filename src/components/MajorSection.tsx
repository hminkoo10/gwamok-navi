import { useMemo, useState } from 'react'
import { FINE_BY_ID, FINE_BY_PARENT, MAJOR_BY_ID, MAJORS } from '../data/majors'
import type { Field } from '../data/schema'
import { UNITS } from '../data/units'
import { fineOf, searchMajors } from '../engine/search'
import { ApiError, matchMajors } from '../lib/api'
import { useApp, useNeedKey } from '../lib/app'
import { KeyNeeded } from './KeyNeeded'
import { IconSearch } from './icons'

const FIELDS: Field[] = ['공학', '자연', '의약', '융합', '인문사회', '교육', '예체능']

interface Props {
  selected: string[]
  onChange: (ids: string[]) => void
  aiEnabled: boolean
}

type Lookup =
  | { state: 'idle' }
  | { state: 'loading'; text: string }
  | { state: 'done'; text: string; majors: { id: string; why: string }[] }
  | { state: 'error'; message: string }

/** 세부 학과 이름 (묶음 이름을 붙여 어느 계열인지 보이게) */
const labelOf = (id: string) => {
  const fine = FINE_BY_ID.get(id)
  if (fine) return { name: fine.name, group: MAJOR_BY_ID.get(fine.parent)?.name ?? '' }
  return { name: MAJOR_BY_ID.get(id)?.name ?? id, group: '계열 전체' }
}

export function MajorSection({ selected, onChange, aiEnabled }: Props) {
  const { features } = useApp()
  const needKey = useNeedKey()
  const [query, setQuery] = useState('')
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' })
  const hits = searchMajors(query).slice(0, 6)
  const trimmed = query.trim()
  const canAsk = aiEnabled && trimmed.length >= 2

  // 세부 학과마다 그 이름으로 뽑는 모집단위 수 (넓은 모집단위 제외)
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const u of UNITS) for (const id of fineOf(u)) m.set(id, (m.get(id) ?? 0) + 1)
    return m
  }, [])

  /** 세부 학과 켜고 끄기. 묶음 전체가 켜져 있었으면 그 학과만 남김 */
  const toggle = (id: string) => {
    const fine = FINE_BY_ID.get(id)
    if (!fine) {
      // 묶음 전체: 켜면 그 묶음의 세부 학과 선택은 지움
      const kids = new Set((FINE_BY_PARENT.get(id) ?? []).map((x) => x.id))
      onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected.filter((x) => !kids.has(x)), id])
      return
    }
    if (selected.includes(fine.parent)) onChange([...selected.filter((x) => x !== fine.parent), id])
    else onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  }
  const isOn = (id: string) => selected.includes(id) || (FINE_BY_ID.has(id) && selected.includes(FINE_BY_ID.get(id)!.parent))

  const ask = async () => {
    if (!canAsk || lookup.state === 'loading') return
    setLookup({ state: 'loading', text: trimmed })
    try {
      const { majors } = await matchMajors(trimmed)
      setLookup({ state: 'done', text: trimmed, majors })
    } catch (e) {
      setLookup({ state: 'error', message: e instanceof ApiError ? e.message : '찾지 못했어요.' })
    }
  }

  const suggestions =
    lookup.state === 'done' && lookup.text === trimmed
      ? lookup.majors.map((m) => ({ id: m.id, note: m.why }))
      : hits.map((h) => ({ id: h.major.id, note: h.matched.join(', ') }))

  return (
    <section className="majors" aria-label="분야 고르기">
      <form
        className="search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          void ask()
        }}
      >
        <IconSearch className="search-icon" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="학과 이름이나 하고 싶은 일 (예: 반도체, 약사, 게임 만들기)"
          aria-label="학과나 하고 싶은 일 검색"
          maxLength={100}
          autoComplete="off"
          enterKeyHint="search"
        />
      </form>
      {features.match && needKey && !trimmed && <KeyNeeded what="문장으로 찾기" other="학과 이름 같은 키워드로는 지금도 찾을 수 있어요." />}
      {aiEnabled && !trimmed && (
        <p className="hint">
          하고 싶은 일을 문장으로 적고 Enter를 누르면 AI가 맞는 세부 학과를 골라 줘요.
          {features.aiTraining && ' 적은 문장은 Google Gemini(무료 등급)로 보내져 Google이 개선에 쓸 수 있으니 이름 같은 개인정보는 적지 마세요.'}
        </p>
      )}

      {trimmed && (
        <div className="suggest" aria-live="polite">
          {lookup.state === 'loading' && lookup.text === trimmed ? (
            <p className="hint">찾는 중…</p>
          ) : suggestions.length ? (
            <ul className="suggest-list">
              {suggestions.map((s) => {
                if (!MAJOR_BY_ID.has(s.id)) return null
                const l = labelOf(s.id)
                const on = isOn(s.id)
                return (
                  <li key={s.id}>
                    <button type="button" className={`suggest-item${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => toggle(s.id)}>
                      <span>
                        {l.name} <em className="suggest-group">{l.group}</em>
                      </span>
                      {s.note && <small>{s.note}</small>}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="hint">{canAsk ? '맞는 키워드가 없어요.' : '맞는 학과가 없어요. 아래 목록에서 골라 주세요.'}</p>
          )}
          {lookup.state === 'error' && <p className="hint is-warn">{lookup.message}</p>}
          {canAsk && !(lookup.state === 'done' && lookup.text === trimmed) && lookup.state !== 'loading' && (
            <button type="button" className="btn-link" onClick={() => void ask()}>
              문장 뜻으로 찾기 (AI)
            </button>
          )}
        </div>
      )}

      <div className="fields">
        {FIELDS.map((field) => (
          <div key={field} className="field">
            <h3>{field}</h3>
            {MAJORS.filter((m) => m.field === field).map((m) => {
              const all = selected.includes(m.id)
              return (
                <div key={m.id} className="major-row">
                  <span className="major-row-name">{m.name}</span>
                  <div className="chips">
                    <button type="button" className={`chip chip-sm${all ? ' is-on' : ''}`} aria-pressed={all} onClick={() => toggle(m.id)}>
                      전체
                    </button>
                    {(FINE_BY_PARENT.get(m.id) ?? []).map((fm) => {
                      const own = selected.includes(fm.id)
                      const n = counts.get(fm.id) ?? 0
                      return (
                        <button
                          key={fm.id}
                          type="button"
                          className={`chip chip-sm${own ? ' is-on' : all ? ' is-implied' : ''}`}
                          aria-pressed={own || all}
                          onClick={() => toggle(fm.id)}
                          title={n ? undefined : '대학 자료에 이 이름의 모집단위가 없어 가까운 학과 자료로 추천해요'}
                        >
                          {fm.name}
                          {n ? <small className="num">{n}</small> : <small className="chip-near">비슷한 학과로</small>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <p className="fine">
        칩 옆 숫자는 그 학과 이름으로 뽑는 모집단위 수예요. 공과대학·자연계열 전체처럼 넓게 뽑는 모집단위는 어느 세부 학과를 골라도 함께 나와요. '비슷한
        학과로'는 대학 자료에 같은 이름의 모집단위가 없어, 가까운 학과(예: 컴퓨터교육 → 컴퓨터공학)가 권하는 과목으로 추천한다는 뜻이에요.
      </p>
    </section>
  )
}
