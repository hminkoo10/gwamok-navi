import { useEffect, useRef, useState } from 'react'
import type { School } from '../data/schema'
import { schoolFromLoose } from '../engine/school'
import {
  ApiError,
  type Candidate,
  discoverCurriculum,
  type Mismatch,
  getCurriculum,
  getTracks,
  readCurriculum,
  type SchoolHit,
  type SchoolKey,
  searchSchools,
  type SharedCurriculum,
  type TrackInfo,
} from '../lib/api'
import { shortSchool, useApp, useNeedKey } from '../lib/app'
import { schoolOrigin, thisCohort } from '../lib/format'
import { safeHref } from '../lib/href'
import { IconCheck, IconSearch, IconTrash } from './icons'
import { KeyNeeded } from './KeyNeeded'

const KIND_LABEL: Record<Candidate['kind'], string> = { pdf: 'PDF', xlsx: '엑셀', hwp: '한글', images: '그림', table: '본문 표' }
const SOURCE_LABEL: Record<Candidate['source'], string> = { schoolinfo: '학교알리미 공시', homepage: '학교 홈페이지' }

/** 원문 학기 합계와 읽은 학점의 차이 합 (작을수록 정확) */
const gapOf = (m: Mismatch[]) => m.reduce((a, x) => a + Math.abs(x.table - x.read), 0)

type Load =
  | { kind: 'idle' }
  | { kind: 'busy'; text: string }
  | { kind: 'reading'; doc: Candidate; candidates: Candidate[]; notes: string[]; prev?: string }
  | { kind: 'list'; candidates: Candidate[]; notes: string[]; error?: string }
  | { kind: 'partial'; school: School; candidates: Candidate[]; notes: string[]; mismatch: Mismatch[] }
  /** 편제표가 학과·과정별로 나뉘어 있어 골라야 할 때 */
  | { kind: 'choose'; variants: string[] }

interface Props {
  /** 파일을 올리거나 직접 입력 (편집기) */
  onEdit: (prefill: School | null, meta?: { name: string; region: string; cohort: number; track?: string }) => void
  onLoaded: () => void
}

/** 체육·예술 학급이 따로 있는 학교의 일반 학급 */
const GENERAL = '일반학급'

/** 학과·과정 이름: 글자·숫자·띄어쓰기와 몇 가지 기호만 (서버와 같은 규칙) */
const cleanDept = (x: string) =>
  x
    .replace(/[^\p{L}\p{N} ·()-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30)

interface TrackOption {
  value: string
  label: string
  classes?: number
}

/** 고를 학과·과정. 하나뿐이면 나뉜 게 아니라 빈 목록 (묻지 않음) */
function trackOptions(info: TrackInfo | null): TrackOption[] {
  if (!info || !info.tracks.length) return []
  const opts: TrackOption[] = info.tracks.map((t) => ({ value: t, label: t, classes: Object.hasOwn(info.classes, t) ? info.classes[t] : undefined }))
  if (info.general) opts.unshift({ value: GENERAL, label: '일반 학급', classes: info.generalClasses })
  return opts.length > 1 ? opts : []
}

/** 서버가 준 편제표도 화면에서 다시 검사 */
function sanitize(raw: School, hit: SchoolHit, cohort: number, track: string): School {
  const id = `neis-${hit.office}-${hit.code}-${cohort}${track ? `-${track}` : ''}`
  const s = schoolFromLoose(raw, { id, name: hit.name, region: hit.region, cohort })
  const source = raw.source && typeof raw.source === 'object' ? raw.source : { title: '', url: '' }
  return {
    ...s,
    source: { title: String(source.title || `${hit.name} 편제표`).slice(0, 160), url: /^https?:\/\//.test(String(source.url)) ? String(source.url) : '' },
    notes: [],
    ...(track ? { track } : {}),
    ...(hit.schoolType || hit.type ? { kind: hit.schoolType || hit.type } : {}),
  }
}

export function SchoolStep({ onEdit, onLoaded }: Props) {
  const { store, features, notify, user } = useApp()
  const server = features.server
  // 자동 읽기 불가: 관리자가 껐거나, 사용자 키 모드인데 내 Gemini 키가 없을 때
  const needKey = useNeedKey()
  const ai = features.read && !needKey
  const [cohort, setCohort] = useState(store.school?.cohort ?? thisCohort())
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SchoolHit[] | null>(null)
  const [searchMsg, setSearchMsg] = useState('')
  const [searching, setSearching] = useState(false)
  const [hit, setHit] = useState<SchoolHit | null>(null)
  const [info, setInfo] = useState<TrackInfo | null>(null)
  const [infoLoading, setInfoLoading] = useState(false)
  const [track, setTrack] = useState('')
  // 목록에 없는 학과·과정 직접 적기
  const [customOpen, setCustomOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const [load, setLoad] = useState<Load>({ kind: 'idle' })
  const [elapsed, setElapsed] = useState(0)
  const abort = useRef<AbortController | null>(null)
  /** 검색 차례 번호. 늦게 온 앞선 검색의 답이 지금 결과를 덮지 않게 */
  const searchSeq = useRef(0)

  // 학교 이름 검색 (입력이 멈추면)
  useEffect(() => {
    const my = ++searchSeq.current
    const term = q.trim()
    if (term.length < 2 || !server) return
    const t = setTimeout(() => {
      setSearching(true)
      searchSchools(term)
        .then((r) => {
          if (my !== searchSeq.current) return
          setHits(r.schools)
          setSearchMsg(r.schools.length ? '' : '찾는 학교가 없어요. 이름을 줄여서 적어 보세요. 예: 반송고')
        })
        .catch((e) => {
          if (my === searchSeq.current) setSearchMsg(e instanceof ApiError ? e.message : '학교를 찾지 못했어요.')
        })
        .finally(() => {
          if (my === searchSeq.current) setSearching(false)
        })
    }, 300)
    return () => clearTimeout(t)
  }, [q, server])

  useEffect(() => {
    if (load.kind !== 'reading') return
    const t = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(t)
  }, [load.kind])

  useEffect(() => () => abort.current?.abort(), [])

  const finish = (h: SchoolHit, tr: string, c: SharedCurriculum) => {
    const s = sanitize(c.school, h, cohort, tr)
    store.saveSchool({ ...s, shared: { id: c.id, at: c.createdAt, ...(c.verified ? { verified: true } : {}) } })
    notify(`${h.name} 편제표를 불러왔어요.`)
    setLoad({ kind: 'idle' })
    setHit(null)
    onLoaded()
  }

  /**
   * tries: 못 읽거나 학점 합계가 원문과 다를 때 다음 파일을 더 읽어 볼 횟수 (처음 자동으로 읽을 때만)
   * best: 지금까지 원문 합계에 가장 가까운 결과. 끝까지 맞는 파일이 없으면 이것을 보여 줌
   */
  const read = async (
    h: SchoolHit,
    tr: string,
    candidates: Candidate[],
    notes: string[],
    doc: Candidate,
    tries = 0,
    prev?: string,
    best?: Extract<Load, { kind: 'partial' }>,
  ) => {
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    setElapsed(0)
    setLoad({ kind: 'reading', doc, candidates, notes, prev })
    try {
      const r = await readCurriculum({ office: h.office, code: h.code, cohort, track: tr, url: doc.url }, ctl.signal)
      if (ctl.signal.aborted) return
      if (r.status === 'ready') finish(h, tr, r.curriculum)
      else if (r.status === 'choose') setLoad({ kind: 'choose', variants: r.variants })
      else if (r.status === 'partial') {
        const here: Extract<Load, { kind: 'partial' }> = {
          kind: 'partial',
          school: sanitize(r.school, h, cohort, tr),
          candidates,
          notes,
          mismatch: r.mismatch ?? [],
        }
        const closer = !best || gapOf(here.mismatch) < gapOf(best.mismatch) ? here : best
        // 학점 합계가 원문과 다르면 다음 파일로 (같은 편제표의 다른 판·형식일 때가 많음)
        const next = tries > 0 ? candidates[candidates.indexOf(doc) + 1] : undefined
        if (next) return void read(h, tr, candidates, notes, next, tries - 1, '앞 파일은 학점 합계가 원문과 달랐어요.', closer)
        setLoad(closer)
      } else setLoad({ kind: 'list', candidates, notes, error: '편제표를 읽지 못했어요.' })
    } catch (e) {
      if (ctl.signal.aborted) return
      const error = e instanceof ApiError ? e.message : '편제표를 읽지 못했어요.'
      // 이 파일만의 문제(422·400: 편제표가 없거나 받을 수 없음)일 때만 다음 파일로.
      // 요청 한도·AI 오류·로그인처럼 다른 파일도 똑같이 막힐 오류면 바로 멈춤 (한도를 연달아 쓰지 않게)
      const fileOnly = e instanceof ApiError && (e.status === 422 || e.status === 400)
      const next = fileOnly && tries > 0 ? candidates[candidates.indexOf(doc) + 1] : undefined
      if (next) return void read(h, tr, candidates, notes, next, tries - 1, error, best)
      setLoad(best ?? { kind: 'list', candidates, notes, error })
    }
  }

  const start = async (h: SchoolHit, tr: string) => {
    setTrack(tr)
    setCustomOpen(false)
    const key: SchoolKey = { office: h.office, code: h.code, cohort, track: tr }
    setLoad({ kind: 'busy', text: '이미 불러온 편제표가 있는지 보는 중' })
    try {
      const shared = await getCurriculum(key)
      if (shared.status === 'ready') return finish(h, tr, shared.curriculum)
      setLoad({ kind: 'busy', text: '학교알리미 공시와 학교 홈페이지에서 편제표를 찾는 중' })
      const found = await discoverCurriculum(key)
      if (ai && found.candidates.length) return void read(h, tr, found.candidates, found.notes, found.candidates[0], 2)
      setLoad({ kind: 'list', candidates: found.candidates, notes: found.notes })
    } catch (e) {
      setLoad({ kind: 'list', candidates: [], notes: [], error: e instanceof ApiError ? e.message : '편제표를 찾지 못했어요.' })
    }
  }

  const choose = async (h: SchoolHit) => {
    abort.current?.abort()
    setHit(h)
    setTrack('')
    setInfo(null)
    setCustomOpen(false)
    setCustom('')
    setLoad({ kind: 'idle' })
    setInfoLoading(true)
    let found: TrackInfo | null = null
    try {
      found = await getTracks(h.office, h.code, cohort)
    } catch {
      found = null
    }
    setInfo(found)
    setInfoLoading(false)
    // 학과·과정이 나뉘지 않은 학교는 바로 불러온다
    if (!trackOptions(found).length) void start(h, '')
  }

  const reset = () => {
    abort.current?.abort()
    setHit(null)
    setInfo(null)
    setTrack('')
    setCustomOpen(false)
    setCustom('')
    setLoad({ kind: 'idle' })
  }

  const busy = load.kind === 'busy' || load.kind === 'reading'
  const options = trackOptions(info)
  const label = (v: string) => (v === GENERAL ? '일반 학급' : v)

  /** 목록에 없는 학과·과정 적기 (과학중점반, 계열별 편제표 등) */
  const customForm = hit && customOpen && (
    <form
      className="custom-track"
      onSubmit={(e) => {
        e.preventDefault()
        const v = cleanDept(custom)
        if (v) void start(hit, v)
      }}
    >
      <input
        className="input"
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
        maxLength={30}
        placeholder="예: 과학중점반, 자연계열, 체육학급"
        aria-label="학과·과정 이름"
        autoComplete="off"
      />
      <button type="submit" className="btn btn-primary" disabled={!cleanDept(custom) || busy}>
        이 과정으로 불러오기
      </button>
    </form>
  )
  const phase = elapsed < 6 ? '파일을 받는 중' : elapsed < 15 ? '편제표가 있는 쪽을 찾는 중' : '과목과 학점을 옮기는 중'

  const candidateList = (candidates: Candidate[]) =>
    candidates.length > 0 && (
      <ul className="cand-list">
        {candidates.map((c) => (
          <li key={c.url} className="cand">
            <div className="cand-main">
              <span className="cand-name">{c.fileName}</span>
              <span className="cand-meta">
                {SOURCE_LABEL[c.source]} · {KIND_LABEL[c.kind]}
                {safeHref(c.postUrl) && (
                  <>
                    {' · '}
                    <a href={safeHref(c.postUrl)} target="_blank" rel="noreferrer noopener">
                      원문 보기
                    </a>
                  </>
                )}
              </span>
            </div>
            {ai && hit && (
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={() => void read(hit, track, candidates, load.kind === 'list' || load.kind === 'partial' ? load.notes : [], c)}
              >
                이 파일 읽기
              </button>
            )}
          </li>
        ))}
      </ul>
    )

  return (
    <div className="school-step">
      {store.schools.length > 0 && !hit && (
        <section className="field-block">
          <h3 className="field-label">저장된 학교</h3>
          <ul className="saved-schools">
            {store.schools.map((s) => {
              const on = store.school?.id === s.id
              return (
                <li key={s.id} className={`saved-school${on ? ' is-on' : ''}`}>
                  <button type="button" className="saved-pick" onClick={() => store.setSchool(s.id)} aria-pressed={on}>
                    <span className="saved-name">
                      {on && <IconCheck />} {s.name}
                    </span>
                    <span className="saved-meta">
                      {s.cohort}학년도 입학{s.track ? ` · ${s.track}` : ''} · {schoolOrigin(s)}
                    </span>
                  </button>
                  <button type="button" className="btn-icon" onClick={() => onEdit(s)} aria-label={`${s.name} 편제표 확인·고치기`} title="편제표 확인·고치기">
                    표
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label={`${s.name} 지우기`}
                    onClick={() => {
                      if (confirm(`${s.name} 편제표를 지울까요?${user ? ' 계정에 저장한 것도 함께 지워져요.' : ''}`)) store.deleteSchool(s.id)
                    }}
                  >
                    <IconTrash />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section className="field-block">
        <h3 className="field-label">입학년도</h3>
        <div className="segmented" role="radiogroup" aria-label="입학년도">
          {[thisCohort() - 1, thisCohort(), thisCohort() + 1].map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={cohort === c}
              className={cohort === c ? 'is-on' : ''}
              disabled={busy}
              onClick={() => {
                setCohort(c)
                if (hit) reset()
              }}
            >
              <strong>{c}</strong>
              <span>{c === thisCohort() ? '지금 고1' : c === thisCohort() - 1 ? '지금 고2' : '예비 고1'}</span>
            </button>
          ))}
        </div>
      </section>

      {!server ? (
        <section className="field-block">
          <p className="hint">이 주소에서는 학교 찾기를 쓸 수 없어요. 학교 홈페이지에서 편제표 파일을 받아 올려 주세요.</p>
          <button type="button" className="btn btn-primary" onClick={() => onEdit(null)}>
            편제표 올리기
          </button>
        </section>
      ) : !hit ? (
        <section className="field-block">
          <h3 className="field-label">학교 찾기</h3>
          <div className="search search-lg">
            <IconSearch className="search-icon" />
            <input
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                if (e.target.value.trim().length < 2) {
                  setHits(null)
                  setSearchMsg('')
                  setSearching(false)
                }
              }}
              placeholder="학교 이름 (예: 반송고)"
              aria-label="학교 이름"
              autoComplete="off"
            />
          </div>
          {searching && !hits?.length && (
            <p className="progress-line hint">
              <span className="spinner" aria-hidden="true" />
              학교를 찾는 중
            </p>
          )}
          {searchMsg && !searching && <p className="hint">{searchMsg}</p>}
          {hits && hits.length > 0 && (
            <ul className="school-hits">
              {hits.map((h) => (
                <li key={`${h.office}-${h.code}`}>
                  <button type="button" className="school-hit" onClick={() => void choose(h)}>
                    <span className="school-hit-name">
                      {h.name}
                      {h.type && h.type !== '일반고' && <span className="pill">{h.type}</span>}
                    </span>
                    <span className="school-hit-meta">{[h.region, h.address].filter(Boolean).join(' · ')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn-link" onClick={() => onEdit(null)}>
            편제표 파일이 있어요
          </button>
        </section>
      ) : (
        <section className="field-block">
          <div className="picked">
            <div>
              <strong className="picked-name">{hit.name}</strong>
              <span className="picked-meta">
                {hit.region} · {hit.type || '고등학교'} · {cohort}학년도 입학
                {track ? ` · ${label(track)}` : ''}
              </span>
            </div>
            <button type="button" className="btn btn-sm" onClick={reset} disabled={load.kind === 'busy'}>
              다른 학교
            </button>
          </div>

          {infoLoading && (
            <p className="progress-line hint">
              <span className="spinner" aria-hidden="true" />
              학과·과정 정보를 확인하는 중
            </p>
          )}

          {options.length > 0 && load.kind === 'idle' && (
            <div className="track-pick">
              <h3 className="field-label">학과·과정</h3>
              <p className="hint">{shortSchool(hit.name)}는 학과·과정마다 교육과정이 달라요. 다니는(다닐) 곳을 골라 주세요.</p>
              <div className="chips" role="radiogroup" aria-label="학과·과정">
                {options.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={!customOpen && track === o.value}
                    className={`chip${!customOpen && track === o.value ? ' is-on' : ''}`}
                    onClick={() => {
                      setTrack(o.value)
                      setCustomOpen(false)
                    }}
                  >
                    {o.label}
                    {o.classes ? <span className="chip-count">{o.classes}반</span> : null}
                  </button>
                ))}
                <button
                  type="button"
                  role="radio"
                  aria-checked={customOpen}
                  className={`chip${customOpen ? ' is-on' : ''}`}
                  onClick={() => setCustomOpen(true)}
                >
                  직접 입력
                </button>
              </div>
              {customOpen ? (
                customForm
              ) : (
                <button type="button" className="btn btn-primary" disabled={!track} onClick={() => void start(hit, track)}>
                  {track ? `${label(track)} 편제표 불러오기` : '학과·과정을 골라 주세요'}
                </button>
              )}
              <p className="fine">
                {info?.source === 'classes' ? '나이스 학급 정보로 찾은 목록이에요.' : '나이스 학과 정보로 찾은 목록이라 지금 없는 학과가 섞여 있을 수 있어요.'}{' '}
                과학중점반처럼 목록에 없는 과정은 직접 입력하세요.
              </p>
            </div>
          )}

          {options.length === 0 && !infoLoading && !busy && load.kind !== 'choose' && (
            <div className="track-note">
              {customOpen ? (
                <>
                  <p className="hint">학과·과정(예: 체육학급, 과학중점반, 자연계열)마다 편제표가 따로 있으면 이름을 적어 주세요. 그 표만 다시 찾아 읽어요.</p>
                  {customForm}
                </>
              ) : (
                <button type="button" className="btn-link" onClick={() => setCustomOpen(true)}>
                  학과·과정마다 편제표가 따로 있나요?
                </button>
              )}
            </div>
          )}

          {load.kind === 'choose' && (
            <div className="load-card">
              <p className="load-title">이 학교 편제표는 학과·과정별로 나뉘어 있어요</p>
              <p className="hint">어느 것을 따르나요? 고르면 그 표만 읽어요.</p>
              <div className="chips">
                {load.variants.map((v) => (
                  <button key={v} type="button" className="chip" onClick={() => void start(hit, v)}>
                    {v}
                  </button>
                ))}
                <button type="button" className={`chip${customOpen ? ' is-on' : ''}`} onClick={() => setCustomOpen(true)}>
                  직접 입력
                </button>
              </div>
              {customForm}
            </div>
          )}

          {load.kind === 'busy' && (
            <div className="load-card" role="status">
              <p className="progress-line">
                <span className="spinner" aria-hidden="true" />
                {load.text}
              </p>
            </div>
          )}

          {load.kind === 'reading' && (
            <div className="load-card" role="status">
              {load.prev && <p className="hint is-warn">{load.prev} 다음 파일을 읽어 볼게요.</p>}
              <p className="load-doc">
                {SOURCE_LABEL[load.doc.source]} · {load.doc.fileName}
              </p>
              <p className="progress-line">
                <span className="spinner" aria-hidden="true" />
                {phase} <span className="num muted">{elapsed}초</span>
              </p>
              <p className="hint">처음 불러오는 학교는 30초에서 1분쯤 걸려요. 한 번 불러온 학교는 다음부터 바로 열려요.</p>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  abort.current?.abort()
                  setLoad({ kind: 'list', candidates: load.candidates, notes: load.notes })
                }}
              >
                그만 읽기
              </button>
            </div>
          )}

          {load.kind === 'partial' && (
            <div className="load-card is-warn">
              <p className="load-title">{load.mismatch.length ? '학점 합계가 원문과 다른 학기가 있어요' : '편제표 일부만 읽혔어요'}</p>
              {load.mismatch.length > 0 ? (
                <ul className="load-notes">
                  {load.mismatch.map((m) => (
                    <li key={m.term}>
                      {m.term[0]}학년 {m.term[2]}학기: 원문 합계 {m.table}학점, 읽은 과목 {m.read}학점
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="hint">빈 학기나 학점이 이상한 곳이 있어요.</p>
              )}
              <p className="hint">표를 열어 원문과 비교해 고친 뒤 저장해 주세요. 다른 파일로 다시 읽어 볼 수도 있어요.</p>
              <div className="row-btns">
                <button type="button" className="btn btn-primary" onClick={() => onEdit(load.school)}>
                  표 열어서 확인하기
                </button>
              </div>
              {candidateList(load.candidates)}
            </div>
          )}

          {load.kind === 'list' && (
            <div className="load-card">
              {load.error && <p className="load-title is-warn-text">{load.error}</p>}
              <p className="hint">
                {load.candidates.length
                  ? ai
                    ? '찾은 파일이에요. 읽을 파일을 골라 주세요.'
                    : features.read && needKey
                      ? '찾은 파일이에요. 자동으로 읽으려면 내 Gemini API 키가 있어야 해요.'
                      : '찾은 파일이에요. 지금은 자동 읽기를 쓸 수 없어서, 파일을 받아 직접 올려 주세요.'
                  : '편제표 파일을 찾지 못했어요. 학교 홈페이지에서 편제표 파일을 받아 올려 주세요.'}
              </p>
              {features.read && needKey && load.candidates.length > 0 && (
                <KeyNeeded what="편제표 자동 읽기" other="키 없이도 아래 '편제표 파일 올리기'에서 과목을 직접 입력할 수 있어요." />
              )}
              {candidateList(load.candidates)}
              {load.notes.length > 0 && (
                <ul className="load-notes">
                  {load.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
              <div className="row-btns">
                <button
                  type="button"
                  className="btn"
                  onClick={() => onEdit(null, { name: hit.name, region: hit.region, cohort, track: track && track !== GENERAL ? track : '' })}
                >
                  편제표 파일 올리기
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
