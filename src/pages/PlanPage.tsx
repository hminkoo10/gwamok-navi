import { useEffect, useMemo, useState } from 'react'
import { ConditionsView } from '../components/ConditionsView'
import { Drawer, type DrawerTarget } from '../components/Drawer'
import { IconAlert, IconCheck, IconClose, IconPin, IconPrint, IconShare } from '../components/icons'
import { SourcesView } from '../components/SourcesView'
import { Timetable } from '../components/Timetable'
import { ChosenList } from '../components/ChosenList'
import { UNIV_BY_ID } from '../data/universities'
import { MAJOR_BY_ID } from '../data/majors'
import { repairChoices } from '../engine/choices'
import { makePlan, offerIndex, reasonsOf } from '../engine/plan'
import { fieldScores, groupSuggestions, relevanceOf, trackSuggestions } from '../engine/suggest'
import { FOCUSES, focusUnits, isExamUnit, unitRoutes } from '../engine/focus'
import { useAdmissions } from '../lib/admissions'
import { FocusPanel } from '../components/FocusPanel'
import { UNITS } from '../data/units'
import { majorUnitsOf, useUnitSeats } from '../lib/selection'
import { SubjectPicker } from '../components/SubjectPicker'
import { useApp } from '../lib/app'
import { Link } from '../components/Link'
import { AdmissionsTab } from '../components/AdmissionsTab'
import { planText } from '../lib/export'
import { jointLinksFor } from '../data/joint'
import { sidoOf } from '../engine/admissions'
import { admissionYearOf } from '../data/schedule'
import { unitLabel } from '../lib/format'
import { ResetDialog } from '../components/ResetDialog'
import { SlotBar } from '../components/SlotBar'
import { SyncNotice } from '../components/SyncNotice'
import { CopyDialog } from '../components/CopyDialog'
import { smoothly } from '../lib/motion'
import { choiceNotice, repairNotice } from '../lib/choiceNotice'
import { copyText, isAbort } from '../lib/clipboard'

type Tab = 'plan' | 'units' | 'admissions' | 'sources'

function Gate({ title, body, to, action }: { title: string; body: string; to: string; action: string }) {
  const { store } = useApp()
  return (
    <div className="wrap gate-wrap">
      {/* 빈 슬롯에서도 다른 슬롯으로 돌아갈 수 있게. 슬롯이 하나면 숨김 */}
      {store.slots.length > 1 && <SlotBar />}
      <SyncNotice />
      <div className="gate">
        <h1 className="page-title">{title}</h1>
        <p className="page-sub">{body}</p>
        <Link to={to} className="btn btn-primary btn-lg">
          {action}
        </Link>
      </div>
    </div>
  )
}

export function PlanPage() {
  const { store, notify } = useApp()
  const { prefs, school } = store
  const [tab, setTab] = useState<Tab>('plan')
  const [resetOpen, setResetOpen] = useState(false)
  const [drawer, setDrawer] = useState<DrawerTarget>(null)
  /** 자동 복사가 막혔을 때 직접 복사하도록 띄울 글 */
  const [manualCopy, setManualCopy] = useState<string | null>(null)
  // 인쇄 머리글 날짜
  const [today] = useState(() => new Date().toLocaleDateString('ko-KR'))

  // 고른 분야 × 목표 대학의 학과 (대학 순서 → 분야 순서, 중복 제거)
  const majorUnits = useMemo(() => majorUnitsOf(prefs.majors, prefs.univs), [prefs.majors, prefs.univs])
  const selectedIds = useMemo(() => new Set(prefs.unitIds ?? majorUnits.map((u) => u.id)), [prefs.unitIds, majorUnits])
  const selectedUnits = useMemo(() => majorUnits.filter((u) => selectedIds.has(u.id)), [majorUnits, selectedIds])
  // 목표 전형에 따라 더 채울 조건 (정시: 수능 출제 과목, 논술: 대학 출제 범위)
  const admissions = useAdmissions()
  // 논술 범위는 고른 학과 계열에 맞는 부분만. 권장과목 조건에서 빠진 학과도 논술은 치르므로 selectedUnits 전체 기준
  const extra = useMemo(
    () => focusUnits(prefs.focus, prefs.univs, admissions.byUniv, selectedUnits),
    [prefs.focus, prefs.univs, admissions.byUniv, selectedUnits],
  )
  // 목표 전형이 학생부를 정성평가하지 않는 학과(수능·교과 성적만 봄)는 권장과목 조건에서 뺌
  const seats = useUnitSeats()
  const routes = useMemo(() => unitRoutes(prefs.focus, selectedUnits, admissions.byUniv, seats), [prefs.focus, selectedUnits, admissions.byUniv, seats])
  const activeUnits = useMemo(() => (prefs.keepAll ? selectedUnits : routes.filter((r) => r.keep).map((r) => r.unit)), [prefs.keepAll, selectedUnits, routes])
  // 진로 관련도: 전국 같은 분야 학과들이 권하는 과목. 빈칸 추천과, 같은 조건을 채우는 과목끼리 고를 때 씀
  const schoolSubjects = useMemo(() => (school ? [...offerIndex(school).keys()] : []), [school])
  const scores = useMemo(
    () => fieldScores(UNITS, prefs.majors, new Set(selectedUnits.map((u) => u.id)), schoolSubjects),
    [prefs.majors, selectedUnits, schoolSubjects],
  )
  const relevance = useMemo(() => relevanceOf(scores), [scores])
  // 고른 대학 자료에 이 분야 학과가 없어도 진로 관련 과목으로 추천
  const noUnits = majorUnits.length === 0
  const plan = useMemo(
    () =>
      school && (selectedUnits.length || noUnits)
        ? makePlan(school, [...activeUnits, ...extra], { pinned: prefs.pinned, excluded: prefs.excluded, relevance })
        : null,
    [school, selectedUnits.length, noUnits, activeUnits, extra, prefs.pinned, prefs.excluded, relevance],
  )
  const reasons = useMemo(() => (plan ? reasonsOf(plan) : new Map()), [plan])
  const suggestions = useMemo(() => (plan ? groupSuggestions(plan, scores, { focus: prefs.focus }) : new Map()), [plan, scores, prefs.focus])
  const setHints = useMemo(() => (plan ? trackSuggestions(plan, scores) : new Map<string, number>()), [plan, scores])
  const skipped = prefs.keepAll ? [] : routes.filter((r) => !r.keep)
  const focusLabel = FOCUSES.find((f) => f.id === prefs.focus)?.label ?? ''

  // 공유 링크는 미리 만들어 둠. 만들 때 압축을 기다려야 하는데, 누른 순간 바로 복사·공유하지 않으면 브라우저가 막음
  const { shareUrl } = store
  const unitKey = selectedUnits.map((u) => u.id).join(',')
  const [link, setLink] = useState<{ for: typeof shareUrl; units: string; url: string } | null>(null)
  useEffect(() => {
    let alive = true
    void shareUrl(unitKey ? unitKey.split(',') : []).then((url) => {
      if (alive) setLink({ for: shareUrl, units: unitKey, url })
    })
    return () => {
      alive = false
    }
  }, [shareUrl, unitKey])
  const readyLink = link && link.for === shareUrl && link.units === unitKey ? link.url : null

  // 저장·공유받은 선택이 규칙에 어긋나면 고치고 알림 (세트를 모두 뺐거나 자리 없는 꼭 듣기)
  const { replaceChoices } = store
  useEffect(() => {
    const from = { pinned: prefs.pinned, excluded: prefs.excluded }
    const fixed = repairChoices(school, from)
    if (!fixed) return
    replaceChoices(from, fixed)
    const text = repairNotice(fixed)
    if (text) notify(text)
  }, [school, prefs.pinned, prefs.excluded, replaceChoices, notify])

  if (!school)
    return <Gate title="먼저 우리 학교를 골라 주세요" body="학교 편제표가 있어야 학기별로 추천할 수 있어요." to="/start?step=school" action="학교 고르기" />
  if (!prefs.majors.length)
    return <Gate title="가고 싶은 분야를 골라 주세요" body="분야를 고르면 그 분야 학과의 권장과목을 모아요." to="/start?step=major" action="분야 고르기" />
  if (!prefs.univs.length) return <Gate title="목표 대학을 골라 주세요" body="대학마다 학과별 권장과목이 달라요." to="/start?step=univ" action="대학 고르기" />

  const toggleUnit = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    store.setUnits(majorUnits.every((u) => next.has(u.id)) ? null : majorUnits.filter((u) => next.has(u.id)).map((u) => u.id))
  }

  /** 꼭 듣기·빼기 결과 알림. 같은 세트 과목이나, 세트·칸이 비지 않게 다른 과목도 함께 바뀔 수 있음 */
  const tell = (text: string | null) => {
    if (text) notify(text)
  }
  // 바뀐 시간표로 부드럽게 전환
  const pin = (subject: string) => smoothly(() => tell(choiceNotice(subject, store.togglePin(subject))))
  const exclude = (subject: string) => smoothly(() => tell(choiceNotice(subject, store.toggleExclude(subject))))

  // 미리 만든 링크가 있으면 바로 복사, 방금 바꿔서 없으면 지금 만듦
  /** 수강 신청용 목록 복사 */
  const copyList = async () => {
    if (!plan) return
    const url = readyLink ?? (await shareUrl(selectedUnits.map((u) => u.id)))
    const text = planText(plan, { units: selectedUnits.map((u) => unitLabel(u.id)), url })
    if (await copyText(text)) notify('수강 신청용 목록을 복사했어요.')
    else setManualCopy(text)
  }

  const share = async () => {
    const url = readyLink ?? (await shareUrl(selectedUnits.map((u) => u.id)))
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ title: '과목내비', url })
        return
      } catch (e) {
        // 공유 창을 닫았으면 그대로, 공유를 못 쓰면 복사로
        if (isAbort(e)) return
      }
    }
    if (await copyText(url)) notify('링크를 복사했어요.')
    else setManualCopy(url)
  }

  const majorNames = prefs.majors.map((m) => MAJOR_BY_ID.get(m)?.name).filter(Boolean) as string[]
  // 목표 전형 조건(수능·논술)은 학과 수에서 뺌. 대학이 권장과목을 정하지 않은 학과(계열 전체 모집 등)는 따로 셈
  const realUnits = plan ? plan.units.filter((r) => !isExamUnit(r.unit.id)) : []
  const withRec = realUnits.filter((r) => r.need > 0)
  const ok = withRec.filter((r) => r.ok).length
  const total = withRec.length
  const openUnits = realUnits.length - total
  const missing = plan?.notOffered ?? []
  // 권장과목으로 채울 학과가 하나도 없을 때의 안내
  const emptyReason = noUnits
    ? {
        main: '고른 대학 자료에는 이 분야 학과가 없어요.',
        sub: '전국의 같은 분야·가까운 학과들이 많이 권하는 과목으로 빈칸을 추천했어요. 대학을 더 고르면 그 대학 권장과목도 채워요.',
      }
    : !realUnits.length
      ? {
          main: `${focusLabel} 기준으로는 고른 학과 ${selectedUnits.length}곳 모두 권장과목을 보지 않아요.`,
          sub: `${prefs.focus === '정시' ? '수능 출제 과목과 ' : ''}진로와 가까운 과목으로 추천했어요. 수시도 함께 준비하면 목표 전형 칸에서 "권장과목도 함께 채우기"를 켜세요.`,
        }
      : !total
        ? {
            main: `고른 학과 ${realUnits.length}곳은 대학이 권장과목을 따로 정하지 않았어요.`,
            sub: '계열 전체로 뽑거나 과목을 자유롭게 고르게 한 곳이에요. 같은 분야 학과들이 많이 권하는 과목으로 빈칸을 추천했어요.',
          }
        : null

  return (
    <div className="wrap plan">
      <SlotBar />
      <SyncNotice />
      <header className="plan-head">
        <div className="plan-title">
          <p className="eyebrow">내 과목 설계</p>
          <h1 className="page-title">
            {school.name}
            <span className="title-meta">
              {school.cohort}학년도 입학{school.track ? ` · ${school.track}` : ''}
            </span>
          </h1>
          <p className="print-only print-meta">
            분야 {majorNames.join(', ')} · 목표 대학 {prefs.univs.map((u) => UNIV_BY_ID.get(u)?.short ?? u).join(', ')} · {today} 과목내비에서 출력
          </p>
          <div className="filters">
            <Link to="/start?step=major" className="filter">
              <span>분야</span>
              {majorNames[0]}
              {majorNames.length > 1 ? ` 외 ${majorNames.length - 1}` : ''}
            </Link>
            <Link to="/start?step=univ" className="filter">
              <span>대학</span>
              {prefs.univs.length}곳
            </Link>
            <button type="button" className="filter" onClick={() => smoothly(() => setTab('units'))}>
              <span>학과</span>
              {selectedUnits.length}/{majorUnits.length}
            </button>
            <Link to="/start?step=school" className="filter">
              <span>학교</span>바꾸기
            </Link>
          </div>
        </div>
        <div className="plan-actions">
          <button type="button" className="btn" onClick={() => void share()} disabled={!plan}>
            <IconShare /> 공유
          </button>
          <button type="button" className="btn" onClick={() => window.print()} disabled={!plan}>
            <IconPrint /> 인쇄
          </button>
          <button type="button" className="btn" onClick={() => void copyList()} disabled={!plan}>
            목록 복사
          </button>
          <button type="button" className="btn btn-danger-quiet" onClick={() => setResetOpen(true)}>
            초기화
          </button>
        </div>
      </header>

      {!plan ? (
        <div className="verdict is-warn">
          <p className="verdict-main">학과를 하나 이상 남겨 주세요.</p>
          <button type="button" className="btn btn-primary" onClick={() => store.setUnits(null)}>
            학과 모두 넣기
          </button>
        </div>
      ) : (
        <>
          {emptyReason ? (
            <section className="verdict" aria-live="polite">
              <span className="verdict-icon" aria-hidden="true">
                <IconAlert />
              </span>
              <div>
                <p className="verdict-main">{emptyReason.main}</p>
                <p className="verdict-sub">{emptyReason.sub}</p>
                {noUnits && (
                  <p className="verdict-links">
                    <Link to="/start?step=univ">대학 다시 고르기</Link>
                  </p>
                )}
              </div>
            </section>
          ) : (
            <section className={`verdict${ok === total ? ' is-ok' : ''}`} aria-live="polite">
              <span className="verdict-icon" aria-hidden="true">
                {ok === total ? <IconCheck /> : <IconAlert />}
              </span>
              <div>
                <p className="verdict-main">
                  {ok === total ? (
                    <>
                      고른 학과 <strong>{total}곳</strong>의 권장과목을 모두 들을 수 있어요.
                    </>
                  ) : (
                    <>
                      고른 학과 {total}곳 중 <strong>{ok}곳</strong>의 권장과목을 모두 들을 수 있어요.
                    </>
                  )}
                </p>
                <p className="verdict-sub">
                  {missing.length
                    ? `우리 학교 편제표에 없는 권장과목: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` 외 ${missing.length - 5}개` : ''}. 공동교육과정이나 온라인학교로 들을 수 있는지 학교에 물어보세요.`
                    : ok === total
                      ? '아래 학기별 추천대로 고르면 돼요.'
                      : '선택 칸이 모자라 다 넣지 못한 과목이 있어요. 학과별 조건에서 확인하세요.'}
                  {missing.length > 0 &&
                    admissionYearOf(school.cohort) >= 2029 &&
                    ' 2029학년도 대입부터 대학은 학교에 개설되지 않은 과목을 공동교육과정·온라인학교로 들은 노력도 고려하도록 권장돼요 (대교협 기본사항).'}
                  {openUnits > 0 && ` 권장과목을 따로 정하지 않은 학과 ${openUnits}곳은 세지 않았어요.`}
                  {skipped.length > 0 && ` ${focusLabel} 기준으로 권장과목을 보지 않는 학과 ${skipped.length}곳은 계산에서 뺐어요.`}
                </p>
                {missing.length > 0 && (
                  <p className="verdict-links">
                    알아볼 곳{' '}
                    {jointLinksFor(sidoOf(school.region)).map((l, i) => (
                      <span key={l.url}>
                        {i > 0 && ' · '}
                        <a href={l.url} target="_blank" rel="noreferrer noopener">
                          {l.name}
                        </a>
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </section>
          )}

          {(plan.pinned.size > 0 || plan.excluded.size > 0) && (
            <div className="choices" aria-label="내가 바꾼 과목">
              {[...plan.pinned].map((s) => (
                <span key={`p-${s}`} className={`choice${plan.unplacedPins.includes(s) ? ' is-warn' : ''}`}>
                  <IconPin /> {s} 꼭 듣기
                  {plan.unplacedPins.includes(s) && <em>넣을 칸 없음</em>}
                  <button type="button" onClick={() => pin(s)} aria-label={`${s} 꼭 듣기 풀기`}>
                    <IconClose />
                  </button>
                </span>
              ))}
              {[...plan.excluded].map((s) => (
                <span key={`x-${s}`} className="choice is-out">
                  {s} 빼기
                  <button type="button" onClick={() => exclude(s)} aria-label={`${s} 다시 넣기`}>
                    <IconClose />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="tabs" role="tablist" aria-label="결과 보기">
            {(
              [
                ['plan', '학기별 추천'],
                ['units', `학과별 조건 ${ok}/${total}`],
                ['admissions', '전형'],
                ['sources', '출처'],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? 'is-on' : ''}
                onClick={() => smoothly(() => setTab(id))}
              >
                {label}
              </button>
            ))}
          </div>

          <section className="tab-panel" hidden={tab !== 'plan'} aria-label="학기별 추천">
            <h2 className="print-only">학기별 추천</h2>
            <FocusPanel
              focus={prefs.focus}
              onChange={(f) => smoothly(() => store.setFocus(f))}
              univs={prefs.univs}
              byUniv={admissions.byUniv}
              school={school}
              loading={admissions.loading}
              routes={routes}
              keepAll={prefs.keepAll}
              onKeepAll={store.setKeepAll}
            />
            <SubjectPicker plan={plan} scores={scores} onTogglePin={pin} onToggleExclude={exclude} />
            <Timetable
              plan={plan}
              reasons={reasons}
              suggestions={suggestions}
              setHints={setHints}
              onPickSet={pin}
              markNoRank={prefs.focus === '교과'}
              onSubject={(s) => setDrawer({ kind: 'subject', subject: s })}
              onGroup={(g) => setDrawer({ kind: 'group', groupId: g })}
            />
            <ChosenList plan={plan} reasons={reasons} suggestions={suggestions} onSubject={(s) => setDrawer({ kind: 'subject', subject: s })} />
          </section>
          <section className="tab-panel" hidden={tab !== 'units'} aria-label="학과별 조건">
            <h2 className="print-only">학과별 조건</h2>
            <ConditionsView
              plan={plan}
              allUnits={majorUnits}
              selectedIds={selectedIds}
              skipped={skipped}
              focusLabel={focusLabel}
              onToggleUnit={toggleUnit}
              onSubject={(s) => setDrawer({ kind: 'subject', subject: s })}
            />
          </section>
          <section className="tab-panel no-print" hidden={tab !== 'admissions'} aria-label="전형">
            {tab === 'admissions' && <AdmissionsTab univIds={prefs.univs} />}
          </section>
          <section className="tab-panel no-print" hidden={tab !== 'sources'} aria-label="출처">
            <SourcesView univIds={new Set(selectedUnits.map((u) => u.univ))} school={school} />
          </section>

          <Drawer target={drawer} plan={plan} scores={scores} onClose={() => setDrawer(null)} onOpen={setDrawer} onTogglePin={pin} onToggleExclude={exclude} />
        </>
      )}
      {resetOpen && <ResetDialog onClose={() => setResetOpen(false)} />}
      {manualCopy !== null && <CopyDialog text={manualCopy} onClose={() => setManualCopy(null)} />}
    </div>
  )
}
