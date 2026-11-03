import { useMemo, useRef, useState } from 'react'
import { smoothly } from '../lib/motion'
import type { Fixed, Group, School, Term, TermId, Track } from '../data/schema'
import { TERMS } from '../data/schema'
import { SUBJECTS } from '../data/subjects'
import { checkSchool, emptySchool, matchSubject } from '../engine/school'
import { ApiError, importCurriculum, type SchoolHit, searchSchools } from '../lib/api'
import { useApp, useNeedKey } from '../lib/app'
import { KeyNeeded } from './KeyNeeded'
import { prepareFiles } from '../lib/files'
import { TERM_LABEL, thisCohort } from '../lib/format'
import { safeHref } from '../lib/href'
import { curriculumKey, normalizeSchool } from '../lib/store'
import { Dialog } from './Dialog'
import { IconPlus, IconSearch, IconTrash, IconUpload } from './icons'

interface Props {
  initial: School | null
  /** 새로 만들 때 미리 채울 학교 이름·지역·입학년도 (학교 찾기에서 넘어온 경우) */
  preset?: { name: string; region: string; cohort: number; track?: string }
  aiEnabled: boolean
  onClose: () => void
  onSave: (school: School) => void
}

const COHORTS = [2025, 2026, 2027]
const newId = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`
const canon = (s: string) => (s.trim() ? matchSubject(s).name : '')
const splitOptions = (text: string) =>
  text
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean)

type ImportState =
  | { state: 'idle' }
  | { state: 'reading'; step: string }
  | { state: 'done'; message: string }
  | { state: 'error'; message: string }
  /** 파일에 학과·과정별 표가 여러 개라 하나를 골라야 할 때 */
  | { state: 'choose'; variants: string[] }

/** 학과·과정 이름: 글자·숫자·띄어쓰기와 몇 가지 기호만 (서버와 같은 규칙) */
const cleanDept = (x: string) =>
  x
    .replace(/[^\p{L}\p{N} ·()-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30)

export function SchoolEditor({ initial, preset, aiEnabled, onClose, onSave }: Props) {
  const { features } = useApp()
  const needKey = useNeedKey()
  const [name, setName] = useState(initial?.name ?? preset?.name ?? '')
  const [region, setRegion] = useState(initial?.region ?? preset?.region ?? '')
  const [cohort, setCohort] = useState(initial?.cohort ?? preset?.cohort ?? thisCohort())
  const [dept, setDept] = useState(initial?.track ?? preset?.track ?? '')
  const [homepage, setHomepage] = useState(initial?.source.url ?? '')
  const [draft, setDraft] = useState<School>(() => initial ?? emptySchool({ id: 'draft', name: '', region: '', cohort: thisCohort() }))
  const [term, setTerm] = useState<TermId>('2-1')
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SchoolHit[] | null>(null)
  const [searchMsg, setSearchMsg] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'file' | 'text'>('file')
  const [imp, setImp] = useState<ImportState>({ state: 'idle' })
  const [optionText, setOptionText] = useState<Record<string, string>>({})
  const searchSeq = useRef(0)
  // 열었을 때 내용. 닫을 때 고친 게 있는지 견줌
  const editorText = () => JSON.stringify([name, region, cohort, dept, homepage, text, draft])
  const [opened] = useState(editorText)
  /** 고친 내용이 있으면 저장하지 않고 닫을지 묻기 */
  const confirmDiscard = () => editorText() === opened || confirm('고친 편제표를 저장하지 않고 닫을까요?')
  const cancel = () => {
    if (confirmDiscard()) onClose()
  }

  const check = useMemo(() => checkSchool({ ...draft, name: name || ' ' }), [draft, name])
  const current = draft.terms.find((t) => t.id === term) ?? { id: term, fixed: [], groups: [] }

  /** 지금 보고 있는 학기만 고침 */
  const patchTerm = (fn: (t: Term) => Term) =>
    setDraft((d) => ({
      ...d,
      terms: TERMS.map((id) => d.terms.find((t) => t.id === id) ?? { id, fixed: [], groups: [] }).map((t) => (t.id === term ? fn(t) : t)),
    }))

  const setFixed = (i: number, patch: Partial<Fixed>) => patchTerm((t) => ({ ...t, fixed: t.fixed.map((f, j) => (j === i ? { ...f, ...patch } : f)) }))
  const setGroup = (id: string, patch: Partial<Group>) => patchTerm((t) => ({ ...t, groups: t.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) }))
  const setTrack = (id: string, fn: (tr: Track) => Track) => setDraft((d) => ({ ...d, tracks: d.tracks.map((tr) => (tr.id === id ? fn(tr) : tr)) }))

  async function findSchool() {
    const query = q.trim()
    if (query.length < 2) return
    // 앞서 찾은 결과가 늦게 와도 지금 찾는 것을 덮지 않게
    const my = ++searchSeq.current
    setSearchMsg('찾는 중…')
    try {
      const { schools } = await searchSchools(query)
      if (my !== searchSeq.current) return
      setHits(schools)
      setSearchMsg(schools.length ? '' : '찾는 학교가 없어요. 아래에 직접 적어 주세요.')
    } catch (e) {
      if (my !== searchSeq.current) return
      setHits(null)
      setSearchMsg(e instanceof ApiError ? e.message : '학교 검색을 쓸 수 없어요. 직접 적어 주세요.')
    }
  }

  /** trackOverride: 여러 학과 표 가운데 고른 학과로 바로 다시 읽을 때 */
  async function runImport(trackOverride?: string) {
    const tr = cleanDept(trackOverride ?? dept)
    try {
      let result
      let truncated = false
      if (mode === 'file') {
        if (!files.length) return
        setImp({ state: 'reading', step: '파일 준비 중…' })
        const prepared = await prepareFiles(files)
        truncated = prepared.truncated
        setImp({ state: 'reading', step: '편제표 읽는 중… 30초에서 1분쯤 걸려요.' })
        result = await importCurriculum({ images: prepared.images, cohort, track: tr || undefined })
      } else {
        if (text.trim().length < 20) return
        setImp({ state: 'reading', step: '편제표 읽는 중…' })
        result = await importCurriculum({ text, cohort, track: tr || undefined })
      }
      if (result.status === 'choose') {
        setImp({ state: 'choose', variants: result.variants })
        return
      }
      setDraft((d) => ({ ...d, terms: result.terms, tracks: result.tracks }))
      setOptionText({})
      const first = result.terms.find((t) => t.groups.length)?.id ?? '2-1'
      setTerm(first)
      const notes = [
        result.unknown.length
          ? `목록에 없는 과목명 ${result.unknown.length}개는 표와 비교해서 고쳐 주세요.`
          : '원래 표와 다른 곳이 없는지 학기별로 확인해 주세요.',
        truncated ? 'PDF는 앞 4쪽만 읽었어요.' : '',
      ]
      setImp({ state: 'done', message: `불러왔어요. ${notes.filter(Boolean).join(' ')}` })
    } catch (e) {
      setImp({ state: 'error', message: e instanceof ApiError || e instanceof Error ? e.message : '읽지 못했어요.' })
    }
  }

  function save() {
    const trimmed = name.trim()
    if (!trimmed) return
    const id = initial?.id ?? `my-${cohort}-${newId('s')}`
    const url = /^https?:\/\//.test(homepage.trim()) ? homepage.trim() : ''
    const tr = cleanDept(dept)
    const clean: School = {
      ...draft,
      id,
      name: trimmed.slice(0, 30),
      region: region.trim().slice(0, 20),
      cohort,
      track: tr || undefined,
      source: { title: url ? `${trimmed} 홈페이지 편제표` : '직접 입력', url },
      checked: new Date().toISOString().slice(0, 10),
      terms: draft.terms.map((t) => ({
        ...t,
        fixed: t.fixed.filter((f) => f.subject.trim()).map((f) => ({ ...f, subject: canon(f.subject), alt: f.alt ? canon(f.alt) || undefined : undefined })),
        groups: t.groups
          .map((g) => ({ ...g, options: [...new Set(g.options.map(canon).filter(Boolean))] }))
          .filter((g) => g.options.length)
          .map((g) => ({ ...g, pick: Math.max(1, Math.min(g.pick, g.options.length)) })),
      })),
      tracks: draft.tracks
        .map((tr) => ({
          ...tr,
          sets: tr.sets
            .map((s) => ({ ...s, items: s.items.filter((it) => it.subject.trim()).map((it) => ({ ...it, subject: canon(it.subject) })) }))
            .filter((s) => s.items.length),
        }))
        .filter((tr) => tr.sets.length),
    }
    // 불러온(공유·확인된) 편제표를 고쳤으면 '확인된 편제표'·틀린 곳 알리기 표시를 뗌. 고친 게 없으면 출처도 그대로
    const { shared, ...rest } = clean
    const same = !!initial && curriculumKey(normalizeSchool(clean)) === curriculumKey(normalizeSchool(initial))
    onSave(shared && same ? { ...clean, source: url === initial.source.url ? initial.source : clean.source, checked: initial.checked } : same ? clean : rest)
  }

  const errors = check.issues.filter((i) => i.level === 'error' && i.message !== '학교 이름이 비어 있어요.')

  return (
    <Dialog
      open
      title={initial ? '편제표 편집' : '편제표 추가'}
      onClose={onClose}
      confirmClose={confirmDiscard}
      wide
      footer={
        <>
          <span className="foot-note">{!name.trim() ? '학교 이름을 적어 주세요.' : errors.length ? `고칠 곳 ${errors.length}개` : ''}</span>
          <button type="button" className="btn" onClick={cancel}>
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={!name.trim()}>
            저장
          </button>
        </>
      }
    >
      <datalist id="subject-names">
        {SUBJECTS.map((s) => (
          <option key={s.name} value={s.name} />
        ))}
      </datalist>

      <div className="ed">
        <div className="ed-main">
          <section className="ed-sec">
            <h3>학교</h3>
            <form
              className="search"
              role="search"
              onSubmit={(e) => {
                e.preventDefault()
                void findSchool()
              }}
            >
              <IconSearch className="search-icon" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="학교 이름으로 찾기" aria-label="학교 이름으로 찾기" maxLength={20} />
            </form>
            {searchMsg && <p className="hint">{searchMsg}</p>}
            {hits && hits.length > 0 && (
              <ul className="hits">
                {hits.map((h) => (
                  <li key={`${h.office}-${h.code}`}>
                    <button
                      type="button"
                      className={`hit${name === h.name ? ' is-on' : ''}`}
                      onClick={() => {
                        setName(h.name)
                        setRegion(h.region)
                        setHomepage(h.homepage)
                      }}
                    >
                      <strong>{h.name}</strong>
                      <span>{h.address}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="ed-row">
              <label className="fld">
                <span>학교 이름</span>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} />
              </label>
              <label className="fld fld-s">
                <span>지역</span>
                <input value={region} onChange={(e) => setRegion(e.target.value)} maxLength={20} />
              </label>
              <label className="fld fld-s">
                <span>입학년도</span>
                <select value={cohort} onChange={(e) => setCohort(Number(e.target.value))}>
                  {COHORTS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fld">
                <span>학과·과정 (있으면)</span>
                <input value={dept} onChange={(e) => setDept(e.target.value)} maxLength={30} placeholder="예: 해킹방어과, 체육학급, 과학중점" />
              </label>
            </div>
            {safeHref(homepage) && (
              <p className="hint">
                편제표는 보통 학교 홈페이지의 교육과정 게시판에 있어요.{' '}
                <a href={safeHref(homepage)} target="_blank" rel="noreferrer noopener">
                  홈페이지 열기
                </a>
              </p>
            )}
          </section>

          {features.import && needKey && (
            <section className="ed-sec">
              <h3>편제표 불러오기</h3>
              <KeyNeeded what="파일 읽기" other="키 없이도 아래 표에 과목을 직접 입력할 수 있어요." />
            </section>
          )}
          {aiEnabled && (
            <section className="ed-sec">
              <h3>편제표 불러오기</h3>
              <div className="seg" role="tablist">
                <button type="button" role="tab" aria-selected={mode === 'file'} className={mode === 'file' ? 'is-on' : ''} onClick={() => setMode('file')}>
                  파일
                </button>
                <button type="button" role="tab" aria-selected={mode === 'text'} className={mode === 'text' ? 'is-on' : ''} onClick={() => setMode('text')}>
                  텍스트
                </button>
              </div>
              {mode === 'file' ? (
                <label
                  className={`drop${files.length ? ' has-file' : ''}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    setFiles([...e.dataTransfer.files].slice(0, 4))
                  }}
                >
                  <input
                    type="file"
                    accept="application/pdf,image/png,image/jpeg,image/webp"
                    multiple
                    onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 4))}
                  />
                  <IconUpload />
                  {files.length ? (
                    <span>{files.map((f) => f.name).join(', ')}</span>
                  ) : (
                    <span>
                      PDF나 사진을 놓거나 눌러서 고르세요
                      <small>PDF는 앞 4쪽까지 읽어요</small>
                    </span>
                  )}
                </label>
              ) : (
                <textarea
                  className="ta"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={6}
                  maxLength={20000}
                  placeholder="편제표 내용을 붙여 넣으세요 (한글 파일에서 표를 복사해도 돼요)"
                />
              )}
              <div className="ed-import">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void runImport()}
                  disabled={imp.state === 'reading' || (mode === 'file' ? !files.length : text.trim().length < 20)}
                >
                  {imp.state === 'reading' ? '읽는 중…' : '읽어서 채우기'}
                </button>
                <span className={`hint${imp.state === 'error' ? ' is-warn' : ''}`}>
                  {imp.state === 'reading'
                    ? imp.step
                    : imp.state === 'done' || imp.state === 'error'
                      ? imp.message
                      : imp.state === 'choose'
                        ? ''
                        : '읽은 결과는 아래 표에서 고칠 수 있어요.'}
                </span>
              </div>
              {imp.state === 'choose' && (
                <div className="choose-track">
                  <p className="load-title">이 파일에는 학과·과정별 편제표가 여러 개 있어요. 어느 것인가요?</p>
                  <div className="chips">
                    {imp.variants.map((v) => (
                      <button
                        key={v}
                        type="button"
                        className="chip"
                        onClick={() => {
                          setDept(v)
                          void runImport(v)
                        }}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                  <p className="fine">고르면 그 표만 다시 읽어요. 목록에 없으면 위 학과·과정 칸에 적고 다시 읽어 주세요.</p>
                </div>
              )}
              <p className="fine">
                올린 파일과 텍스트는 편제표를 읽을 때만 외부 AI 서비스로 보내고 저장하지 않아요.
                {features.aiTraining &&
                  ' 지금 쓰는 Google Gemini 무료 등급은 보낸 내용을 Google이 개선에 쓰고 검토자가 읽을 수 있으니, 개인정보가 담긴 파일은 올리지 마세요.'}
              </p>
            </section>
          )}

          <section className="ed-sec">
            <h3>학기별 과목</h3>
            <div className="term-tabs" role="tablist">
              {TERMS.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={term === t}
                  className={term === t ? 'is-on' : ''}
                  onClick={() => smoothly(() => setTerm(t))}
                >
                  {t}
                  <small className="num">{check.credits[t] || '-'}</small>
                </button>
              ))}
            </div>

            <h4 className="ed-h4">학교 지정 과목</h4>
            <div className="rows">
              {current.fixed.map((f, i) => (
                <div key={i} className="row">
                  <input
                    className="in-subject"
                    list="subject-names"
                    value={f.subject}
                    onChange={(e) => setFixed(i, { subject: e.target.value })}
                    onBlur={(e) => setFixed(i, { subject: canon(e.target.value) })}
                    aria-label="과목명"
                    placeholder="과목명"
                  />
                  <input
                    className="in-num"
                    type="number"
                    min={1}
                    max={12}
                    value={f.credits}
                    onChange={(e) => setFixed(i, { credits: Number(e.target.value) })}
                    aria-label="학점"
                  />
                  <input
                    className="in-alt"
                    list="subject-names"
                    value={f.alt ?? ''}
                    onChange={(e) => setFixed(i, { alt: e.target.value || undefined })}
                    onBlur={(e) => setFixed(i, { alt: canon(e.target.value) || undefined })}
                    aria-label="집중이수 짝 과목"
                    placeholder="짝 과목(집중이수)"
                  />
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => patchTerm((t) => ({ ...t, fixed: t.fixed.filter((_, j) => j !== i) }))}
                    aria-label="삭제"
                  >
                    <IconTrash />
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-sm" onClick={() => patchTerm((t) => ({ ...t, fixed: [...t.fixed, { subject: '', credits: 3 }] }))}>
                <IconPlus /> 과목
              </button>
            </div>

            <h4 className="ed-h4">선택 묶음</h4>
            <div className="rows">
              {current.groups.map((g) => (
                <div key={g.id} className="grp">
                  <div className="row">
                    <input
                      className="in-label"
                      value={g.label}
                      onChange={(e) => setGroup(g.id, { label: e.target.value })}
                      aria-label="묶음 이름"
                      placeholder="묶음 이름"
                      maxLength={30}
                    />
                    <label className="in-inline">
                      택
                      <input
                        className="in-num"
                        type="number"
                        min={1}
                        max={10}
                        value={g.pick}
                        onChange={(e) => setGroup(g.id, { pick: Number(e.target.value) })}
                        aria-label="고르는 과목 수"
                      />
                    </label>
                    <label className="in-inline">
                      학점
                      <input
                        className="in-num"
                        type="number"
                        min={1}
                        max={12}
                        value={g.credits}
                        onChange={(e) => setGroup(g.id, { credits: Number(e.target.value) })}
                        aria-label="과목당 학점"
                      />
                    </label>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => patchTerm((t) => ({ ...t, groups: t.groups.filter((x) => x.id !== g.id) }))}
                      aria-label="묶음 삭제"
                    >
                      <IconTrash />
                    </button>
                  </div>
                  <textarea
                    className="ta ta-opts"
                    rows={2}
                    value={optionText[g.id] ?? g.options.join(', ')}
                    onChange={(e) => {
                      setOptionText((o) => ({ ...o, [g.id]: e.target.value }))
                      setGroup(g.id, { options: splitOptions(e.target.value) })
                    }}
                    onBlur={() => {
                      setOptionText((o) => {
                        const rest = { ...o }
                        delete rest[g.id]
                        return rest
                      })
                      setGroup(g.id, { options: g.options.map(canon).filter(Boolean) })
                    }}
                    placeholder="과목을 쉼표로 나눠 적기 (예: 물리학, 화학, 생명과학)"
                    aria-label="묶음 과목"
                  />
                </div>
              ))}
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => patchTerm((t) => ({ ...t, groups: [...t.groups, { id: newId(`${term}-g`), label: '선택', pick: 1, credits: 3, options: [] }] }))}
              >
                <IconPlus /> 선택 묶음
              </button>
            </div>

            <h4 className="ed-h4">학기를 잇는 세트 선택</h4>
            <p className="fine">예: 2학년 1학기 일본어 → 2학기 일본어 회화처럼 두 학기를 묶어 고르는 경우</p>
            <div className="rows">
              {draft.tracks.map((tr) => (
                <div key={tr.id} className="grp">
                  <div className="row">
                    <input
                      className="in-label"
                      value={tr.label}
                      onChange={(e) => setTrack(tr.id, (x) => ({ ...x, label: e.target.value }))}
                      aria-label="세트 묶음 이름"
                      maxLength={30}
                    />
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => setDraft((d) => ({ ...d, tracks: d.tracks.filter((x) => x.id !== tr.id) }))}
                      aria-label="세트 묶음 삭제"
                    >
                      <IconTrash />
                    </button>
                  </div>
                  {tr.sets.map((set, si) => (
                    <div key={si} className="set">
                      <input
                        className="in-label"
                        value={set.label}
                        onChange={(e) => setTrack(tr.id, (x) => ({ ...x, sets: x.sets.map((s, j) => (j === si ? { ...s, label: e.target.value } : s)) }))}
                        aria-label="세트 이름"
                        maxLength={20}
                      />
                      {set.items.map((it, ii) => (
                        <div key={ii} className="row">
                          <select
                            value={it.term}
                            onChange={(e) =>
                              setTrack(tr.id, (x) => ({
                                ...x,
                                sets: x.sets.map((s, j) =>
                                  j === si ? { ...s, items: s.items.map((y, k) => (k === ii ? { ...y, term: e.target.value as TermId } : y)) } : s,
                                ),
                              }))
                            }
                            aria-label="학기"
                          >
                            {TERMS.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                          <input
                            className="in-subject"
                            list="subject-names"
                            value={it.subject}
                            onChange={(e) =>
                              setTrack(tr.id, (x) => ({
                                ...x,
                                sets: x.sets.map((s, j) =>
                                  j === si ? { ...s, items: s.items.map((y, k) => (k === ii ? { ...y, subject: e.target.value } : y)) } : s,
                                ),
                              }))
                            }
                            aria-label="과목명"
                            placeholder="과목명"
                          />
                          <input
                            className="in-num"
                            type="number"
                            min={1}
                            max={12}
                            value={it.credits}
                            onChange={(e) =>
                              setTrack(tr.id, (x) => ({
                                ...x,
                                sets: x.sets.map((s, j) =>
                                  j === si ? { ...s, items: s.items.map((y, k) => (k === ii ? { ...y, credits: Number(e.target.value) } : y)) } : s,
                                ),
                              }))
                            }
                            aria-label="학점"
                          />
                          <button
                            type="button"
                            className="btn-icon"
                            onClick={() =>
                              setTrack(tr.id, (x) => ({
                                ...x,
                                sets: x.sets.map((s, j) => (j === si ? { ...s, items: s.items.filter((_, k) => k !== ii) } : s)),
                              }))
                            }
                            aria-label="삭제"
                          >
                            <IconTrash />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="btn btn-sm btn-quiet"
                        onClick={() =>
                          setTrack(tr.id, (x) => ({
                            ...x,
                            sets: x.sets.map((s, j) => (j === si ? { ...s, items: [...s.items, { term: '2-1', subject: '', credits: 3 }] } : s)),
                          }))
                        }
                      >
                        <IconPlus /> 과목
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn btn-sm btn-quiet"
                    onClick={() => setTrack(tr.id, (x) => ({ ...x, sets: [...x.sets, { label: `세트${x.sets.length + 1}`, items: [] }] }))}
                  >
                    <IconPlus /> 세트
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    tracks: [
                      ...d.tracks,
                      {
                        id: newId('track'),
                        label: '세트 선택',
                        sets: [
                          { label: '세트1', items: [] },
                          { label: '세트2', items: [] },
                        ],
                      },
                    ],
                  }))
                }
              >
                <IconPlus /> 세트 묶음
              </button>
            </div>
          </section>
        </div>

        <aside className="ed-side" aria-label="확인">
          <h3>확인</h3>
          <table className="credits">
            <tbody>
              {TERMS.map((t) => (
                <tr key={t}>
                  <th scope="row">{TERM_LABEL[t]}</th>
                  <td className="num">{check.credits[t] || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {check.issues.filter((i) => i.message !== '학교 이름이 비어 있어요.').length > 0 && (
            <ul className="issues">
              {check.issues
                .filter((i) => i.message !== '학교 이름이 비어 있어요.')
                .map((i, k) => (
                  <li key={k} className={i.level === 'error' ? 'is-err' : ''}>
                    {i.term ? `${i.term} · ` : ''}
                    {i.message}
                  </li>
                ))}
            </ul>
          )}
          {check.unknown.length > 0 && (
            <div className="unknown">
              <p>과목 목록에 없는 이름</p>
              <ul>
                {check.unknown.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
              <p className="fine">권장과목과 맞춰 보려면 정확한 과목명이 필요해요. 학교 전용 과목이면 그대로 둬도 됩니다.</p>
            </div>
          )}
        </aside>
      </div>
    </Dialog>
  )
}
