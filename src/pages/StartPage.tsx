import { useState } from 'react'
import { IconArrow, IconBack, IconCheck } from '../components/icons'
import { MajorSection } from '../components/MajorSection'
import { ProfileForm } from '../components/ProfileForm'
import { SchoolEditor } from '../components/SchoolEditor'
import { SchoolStep } from '../components/SchoolStep'
import { SlotBar } from '../components/SlotBar'
import { UnivSelect } from '../components/UnivSelect'
import { MAJOR_BY_ID } from '../data/majors'
import type { School } from '../data/schema'
import { shortSchool, useApp, useNeedKey } from '../lib/app'
import { navigate, useLocation } from '../lib/router'

type StepKey = 'school' | 'major' | 'univ' | 'profile'

const STEPS: { key: StepKey; label: string; title: string; sub: string }[] = [
  {
    key: 'school',
    label: '학교',
    title: '어느 학교에 다니나요?',
    sub: '학교를 고르면 그 학교 교육과정 편제표(학년·학기별로 듣는 과목을 정한 표)를 찾아 불러와요.',
  },
  { key: 'major', label: '분야', title: '어떤 분야로 가고 싶나요?', sub: '여러 개 골라도 돼요. 학과 이름이나 하고 싶은 일로 찾을 수도 있어요.' },
  { key: 'univ', label: '대학', title: '목표 대학을 골라 주세요', sub: '고른 분야의 학과가 있는 대학이 먼저 나와요. 여러 곳 골라도 돼요.' },
  {
    key: 'profile',
    label: '조건',
    title: '내 조건을 알려 주세요',
    sub: '같은 대학이라도 다니는 학교와 내 조건에 따라 지원할 수 있는 전형이 달라요. 잘 모르면 그냥 넘어가도 되고, 나중에 전형 찾기에서 바꿀 수 있어요.',
  },
]

type Editor = { open: false } | { open: true; school: School | null; preset?: { name: string; region: string; cohort: number; track?: string } }

export function StartPage() {
  const { store, features, notify } = useApp()
  const needKey = useNeedKey()
  const { query } = useLocation()
  const [editor, setEditor] = useState<Editor>({ open: false })
  const { prefs, school } = store

  // 조건은 고르지 않아도 된다
  const done: Record<StepKey, boolean> = { school: !!school, major: prefs.majors.length > 0, univ: prefs.univs.length > 0, profile: true }
  // 앞 단계를 마쳐야 뒤 단계로 갈 수 있다 (주소로 바로 들어와도 마치지 않은 첫 단계를 보여 준다)
  const reachable = (i: number) => STEPS.slice(0, i).every((s) => done[s.key])
  const asked = STEPS.findIndex((s) => s.key === query.get('step'))
  const firstOpen = STEPS.find((s) => !done[s.key])?.key ?? 'school'
  const current: StepKey = asked >= 0 && reachable(asked) ? STEPS[asked].key : firstOpen
  const index = STEPS.findIndex((s) => s.key === current)
  const step = STEPS[index]
  const go = (key: StepKey) => navigate(`/start?step=${key}`)
  const next = () => (index === STEPS.length - 1 ? navigate('/plan') : go(STEPS[index + 1].key))

  const summary: Record<StepKey, string> = {
    school: school ? `${shortSchool(school.name)} ${school.cohort}${school.track ? ` ${school.track}` : ''}` : '',
    major: prefs.majors.length ? `${MAJOR_BY_ID.get(prefs.majors[0])?.name ?? ''}${prefs.majors.length > 1 ? ` 외 ${prefs.majors.length - 1}` : ''}` : '',
    univ: prefs.univs.length ? `${prefs.univs.length}곳` : '',
    profile:
      prefs.profile.status === '졸업생' || prefs.profile.schoolType || prefs.profile.region || prefs.profile.special.length || prefs.profile.types.length
        ? '골랐음'
        : '',
  }
  // 조건은 고르지 않아도 넘어갈 수 있지만, 고르기 전에는 끝난 단계처럼 보이지 않게 한다
  const looksDone = (k: StepKey) => (k === 'profile' ? !!summary.profile : done[k])

  return (
    <>
      {/* 어느 슬롯을 채우는 중인지 (슬롯이 하나뿐이면 숨긴다). 설계 화면과 같은 자리·폭에 둔다 */}
      {store.slots.length > 1 && (
        <div className="wrap slot-top">
          <SlotBar />
        </div>
      )}
      <div className="wrap start">
        <ol className="stepper" aria-label="진행 단계">
          {STEPS.map((s, i) => {
            const state = s.key === current ? 'is-on' : looksDone(s.key) ? 'is-done' : ''
            return (
              <li key={s.key} className={state}>
                <button type="button" onClick={() => go(s.key)} disabled={!reachable(i)} aria-current={s.key === current ? 'step' : undefined}>
                  <span className="stepper-no num">{looksDone(s.key) && s.key !== current ? <IconCheck /> : i + 1}</span>
                  <span className="stepper-text">
                    <strong>{s.label}</strong>
                    {summary[s.key] ? <small>{summary[s.key]}</small> : s.key === 'profile' && <small>안 골라도 돼요</small>}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>

        <header className="start-head">
          <h1 className="page-title">{step.title}</h1>
          <p className="page-sub">{step.sub}</p>
        </header>

        <div className="start-body">
          {current === 'school' && <SchoolStep onEdit={(prefill, preset) => setEditor({ open: true, school: prefill, preset })} onLoaded={() => go('major')} />}
          {current === 'major' && <MajorSection selected={prefs.majors} onChange={store.setMajors} aiEnabled={features.match && !needKey} />}
          {current === 'univ' && <UnivSelect />}
          {current === 'profile' && <ProfileForm />}
        </div>

        <div className="start-nav">
          {index > 0 ? (
            <button type="button" className="btn" onClick={() => go(STEPS[index - 1].key)}>
              <IconBack /> 이전
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="btn btn-primary btn-lg" disabled={!done[current]} onClick={next}>
            {index === STEPS.length - 1 ? '결과 보기' : '다음'} <IconArrow />
          </button>
        </div>

        {editor.open && (
          <SchoolEditor
            key={editor.school?.id ?? 'new'}
            initial={editor.school}
            preset={editor.preset}
            aiEnabled={features.import && !needKey}
            onClose={() => setEditor({ open: false })}
            onSave={(s) => {
              store.saveSchool(s)
              setEditor({ open: false })
              notify(`${s.name} 편제표를 저장했어요.`)
            }}
          />
        )}
      </div>
    </>
  )
}
