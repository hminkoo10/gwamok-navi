import { type FormEvent, useEffect, useRef, useState } from 'react'
import { smoothly } from '../lib/motion'
import { MAJOR_BY_ID } from '../data/majors'
import type { School } from '../data/schema'
import { FOCUSES } from '../engine/focus'
import { shortSchool, useApp } from '../lib/app'
import { dateTime, josa } from '../lib/format'
import { type Design, MAX_SLOTS, type Slot } from '../lib/store'
import { Dialog } from './Dialog'
import { IconPlus } from './icons'

/** 슬롯 한 줄 요약: 학교 · 분야 · 대학 수 · 목표 전형 */
function summary(d: Design, schools: School[]): string {
  const school = schools.find((s) => s.id === d.schoolId)
  const majors = d.majors.map((m) => MAJOR_BY_ID.get(m)?.name).filter(Boolean)
  return [
    school ? shortSchool(school.name) : '학교 없음',
    majors.length ? `${majors[0]}${majors.length > 1 ? ` 외 ${majors.length - 1}` : ''}` : '분야 없음',
    `대학 ${d.univs.length}곳`,
    FOCUSES.find((f) => f.id === d.focus)?.label ?? d.focus,
  ].join(' · ')
}

/** 목적격 조사를 붙인 말: 슬롯 1 → 슬롯 1을, 컴퓨터 A안 → 컴퓨터 A안을 */
const eul = (word: string) => `${word}${josa(word, '을', '를')}`

/**
 * 슬롯 줄: 설계를 여러 개 저장해 두고 눌러서 오간다. 고친 내용은 지금 슬롯에 바로 저장된다.
 * 새 슬롯(빈 슬롯·지금 설계 복사)과 관리(이름·복제·지우기)도 여기서 한다.
 */
export function SlotBar() {
  const { store, notify } = useApp()
  const { slots, prefs, schools } = store
  const [manage, setManage] = useState(false)
  const menu = useRef<HTMLDetailsElement>(null)

  // 새 슬롯 메뉴: 밖을 누르거나 Esc면 닫음
  useEffect(() => {
    const close = (e: Event) => {
      const el = menu.current
      if (!el?.open) return
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !el.contains(e.target as Node)) el.open = false
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [])

  const open = (s: Slot) => {
    if (s.id === prefs.slot) return
    // 다른 슬롯 설계로 부드럽게 전환
    smoothly(() => {
      store.switchSlot(s.id)
      notify(`${eul(s.name)} 열었어요.`)
    })
  }

  const add = (copy: boolean) => {
    if (menu.current) menu.current.open = false
    const slot = store.addSlot(copy ? prefs.slot : undefined)
    if (!slot) return notify(`슬롯은 ${MAX_SLOTS}개까지 만들 수 있어요.`)
    notify(copy ? `지금 설계를 복사해 ${eul(slot.name)} 열었어요.` : `빈 ${eul(slot.name)} 열었어요. 학교는 그대로예요.`)
  }

  return (
    <div className="slot-bar no-print">
      <span className="slot-label" id="slot-bar-label">
        슬롯
      </span>
      <div className="slot-chips" role="group" aria-labelledby="slot-bar-label">
        {slots.map((s) => {
          const on = s.id === prefs.slot
          return (
            <button key={s.id} type="button" className={`slot-chip${on ? ' is-on' : ''}`} aria-pressed={on} title={summary(s, schools)} onClick={() => open(s)}>
              {s.name}
            </button>
          )
        })}
      </div>
      <div className="slot-tools">
        {slots.length < MAX_SLOTS && (
          <details className="slot-add" ref={menu}>
            <summary className="btn btn-sm">
              <IconPlus /> 새 슬롯
            </summary>
            <div className="slot-menu">
              <button type="button" onClick={() => add(false)}>
                <strong>빈 슬롯</strong>
                <small>학교만 두고 분야·대학을 새로 골라요</small>
              </button>
              <button type="button" onClick={() => add(true)}>
                <strong>지금 설계 복사</strong>
                <small>복사본을 고쳐서 지금 설계와 비교해요</small>
              </button>
            </div>
          </details>
        )}
        <button type="button" className="btn btn-sm" onClick={() => setManage(true)}>
          관리
        </button>
      </div>
      {manage && <SlotsDialog onClose={() => setManage(false)} />}
    </div>
  )
}

/** 슬롯 관리: 열기·이름 바꾸기·복제·지우기 */
function SlotsDialog({ onClose }: { onClose: () => void }) {
  const { store, notify, user } = useApp()
  const { slots, prefs, schools } = store
  const [renaming, setRenaming] = useState<string | null>(null)
  const [name, setName] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) input.current?.select()
  }, [renaming])

  const rename = (e: FormEvent, s: Slot) => {
    e.preventDefault()
    if (name.trim()) store.renameSlot(s.id, name)
    setRenaming(null)
  }

  return (
    <Dialog
      open
      title="슬롯 관리"
      mid
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          닫기
        </button>
      }
    >
      <div className="plans-box">
        <p className="hint">
          슬롯마다 학교·분야·대학·학과·꼭 듣기/빼기·목표 전형을 따로 저장해요. 고친 내용은 지금 슬롯에 바로 저장되고, 내 조건과 원서 후보는 모든 슬롯이 같이
          써요. 슬롯은 {MAX_SLOTS}개까지 만들 수 있어요{user ? ' (계정에도 저장)' : ''}.
        </p>
        <ul className="plans-list">
          {slots.map((s) => {
            const on = s.id === prefs.slot
            return (
              <li key={s.id} className={on ? 'is-on' : ''}>
                {renaming === s.id ? (
                  <form className="slot-rename" onSubmit={(e) => rename(e, s)}>
                    <input ref={input} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} aria-label="슬롯 이름" />
                    <button type="submit" className="btn btn-sm btn-primary" disabled={!name.trim()}>
                      저장
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => setRenaming(null)}>
                      취소
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="plans-main">
                      <strong>
                        {s.name}
                        {on && <span className="pill">지금 슬롯</span>}
                      </strong>
                      <span className="muted small">
                        {summary(s, schools)}
                        {/* 지금 슬롯은 고칠 때마다 바뀌어 날짜 생략 */}
                        {!on && s.at ? ` · ${dateTime(s.at, false)}` : ''}
                      </span>
                    </div>
                    <div className="row-btns">
                      {!on && (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => {
                            store.switchSlot(s.id)
                            notify(`${eul(s.name)} 열었어요.`)
                            onClose()
                          }}
                        >
                          열기
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          setName(s.name)
                          setRenaming(s.id)
                        }}
                      >
                        이름 바꾸기
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={slots.length >= MAX_SLOTS}
                        onClick={() => {
                          const copy = store.addSlot(s.id)
                          if (copy) notify(`${eul(copy.name)} 만들어 열었어요.`)
                        }}
                      >
                        복제
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger-quiet"
                        disabled={slots.length <= 1}
                        title={slots.length <= 1 ? '하나 남은 슬롯은 지울 수 없어요. 비우려면 초기화를 쓰세요.' : undefined}
                        onClick={() => {
                          if (confirm(`${eul(s.name)} 지울까요?${on ? ' 지금 보는 슬롯이라 옆 슬롯을 열어요.' : ''}`)) store.deleteSlot(s.id)
                        }}
                      >
                        지우기
                      </button>
                    </div>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </Dialog>
  )
}
