import { describe, expect, it } from 'vitest'
import type { School } from '../data/schema'
import { EMPTY_PROFILE } from '../engine/admissions'
import { emptySchool, schoolFromLoose } from '../engine/school'
import { josa } from './format'
import {
  curriculumKey,
  designOf,
  type LocalState,
  MAX_SLOTS,
  mergeSaved,
  normalizeSchool,
  payloadOf,
  placeShared,
  type Prefs,
  restoreSlots,
  type Slot,
  snapshotOf,
  unusedSlotName,
  withSlots,
} from './store'
import { hashText } from './sync'

const SCHOOL = emptySchool({ id: 'my-school', name: '반송고등학교', region: '부산', cohort: 2026 })
const IDS = new Set([SCHOOL.id])

const prefs = (extra: Partial<Prefs> = {}): Prefs => ({
  majors: [],
  univs: [],
  unitIds: null,
  schoolId: '',
  pinned: [],
  excluded: [],
  profile: EMPTY_PROFILE,
  picks: [],
  focus: '종합',
  keepAll: false,
  slot: '',
  ...extra,
})

const slot = (id: string, name: string, extra: Partial<Slot> = {}): Slot => ({
  id,
  name,
  at: '2026-10-20T00:00:00.000Z',
  schoolId: SCHOOL.id,
  majors: ['cs'],
  univs: ['snu'],
  unitIds: null,
  pinned: [],
  excluded: [],
  focus: '종합',
  keepAll: false,
  ...extra,
})

describe('슬롯 되살리기', () => {
  it('예전 설계안은 목표 전형 없이 그대로 슬롯이 되고, 맞지 않는 칸은 버린다', () => {
    const first = {
      id: 'p-abc',
      name: ' 컴퓨터   A안 ',
      at: '2026-10-01',
      schoolId: SCHOOL.id,
      majors: ['cs'],
      univs: ['snu', 'nope'],
      unitIds: null,
      pinned: ['미적분Ⅱ'],
      excluded: [],
    }
    const old = [first, { id: 'p-abc', name: '같은 id', majors: [] }, { id: 'Bad Id', name: '이상한 id' }, { id: 'p-x', name: '' }, 'not an object']
    const slots = restoreSlots(old, IDS)
    expect(slots).toHaveLength(1)
    expect(slots[0]).toMatchObject({ id: 'p-abc', name: '컴퓨터 A안', univs: ['snu'], pinned: ['미적분Ⅱ'], focus: '종합', keepAll: false })
    // 학교를 지웠어도 id는 남긴다 (열 때 지금 학교로 바꾼다)
    expect(restoreSlots([{ ...first, schoolId: 'gone' }], IDS)[0].schoolId).toBe('gone')
    expect(
      restoreSlots(
        Array.from({ length: 15 }, (_, i) => ({ id: `s-${i}`, name: `슬롯 ${i}` })),
        IDS,
      ),
    ).toHaveLength(MAX_SLOTS)
  })
})

describe('지금 설계를 슬롯에 맞추기', () => {
  it('슬롯이 없으면 지금 설계로 슬롯 1을 만든다', () => {
    const r = withSlots(prefs({ schoolId: SCHOOL.id, majors: ['cs'] }), [])
    expect(r.slots).toHaveLength(1)
    expect(r.slots[0]).toMatchObject({ name: '슬롯 1', majors: ['cs'], schoolId: SCHOOL.id })
    expect(r.prefs.slot).toBe(r.slots[0].id)
  })

  it('예전 설계안 중 지금 설계와 같은 것이 있으면 그 슬롯을 연다', () => {
    const a = slot('p-a', 'A안')
    const b = slot('p-b', 'B안', { majors: ['cs'], univs: ['korea'] })
    const r = withSlots(prefs({ schoolId: SCHOOL.id, majors: ['cs'], univs: ['korea'] }), [a, b])
    expect(r.slots.map((s) => s.id)).toEqual(['p-a', 'p-b'])
    expect(r.prefs.slot).toBe('p-b')
  })

  it('같은 것이 없으면 지금 설계를 새 슬롯으로 앞에 두고, 이미 있는 이름은 피한다', () => {
    const r = withSlots(prefs({ schoolId: SCHOOL.id, majors: ['cs'], univs: ['yonsei'] }), [slot('p-a', '슬롯 1')])
    expect(r.slots.map((s) => s.name)).toEqual(['슬롯 2', '슬롯 1'])
    expect(r.prefs.slot).toBe(r.slots[0].id)
  })

  it('가리키는 슬롯의 내용이 지금 설계와 다르면 지금 설계로 맞춘다', () => {
    const r = withSlots(prefs({ slot: 'p-a', schoolId: SCHOOL.id, majors: ['cs'], univs: ['korea'], focus: '정시' }), [slot('p-a', 'A안')])
    expect(r.slots[0]).toMatchObject({ id: 'p-a', univs: ['korea'], focus: '정시' })
  })
})

describe('계정 설계와 이 기기 설계 합치기', () => {
  const remoteData = (extra: Record<string, unknown> = {}) => ({
    prefs: prefs({ slot: 'r-1', schoolId: SCHOOL.id, majors: ['cs'], univs: ['snu'] }),
    schools: [],
    plans: [slot('r-1', '슬롯 1'), slot('r-2', '의약 B안', { majors: [] })],
    ...extra,
  })

  it('계정에서 보던 슬롯을 열고, 이 기기에만 있던 슬롯은 고른 게 있을 때만 덧붙인다', () => {
    const local = {
      prefs: prefs({ slot: 'l-1', schoolId: SCHOOL.id, majors: ['cs'], univs: ['korea'] }),
      schools: [SCHOOL],
      slots: [slot('l-1', '슬롯 1', { univs: ['korea'] }), slot('l-2', '빈 슬롯', { majors: [], univs: [] })],
    }
    const m = mergeSaved(remoteData(), local)!
    expect(m.prefs.slot).toBe('r-1')
    expect(m.prefs.univs).toEqual(['snu'])
    // 이름이 겹치면 이 기기 것에 표시를 붙이고, 빈 슬롯은 쌓지 않는다
    expect(m.slots.map((s) => s.name)).toEqual(['슬롯 1', '의약 B안', '슬롯 1 (이 기기)'])
    expect(m.schools.map((s) => s.id)).toEqual([SCHOOL.id])
  })

  it('계정이 비어 있으면 이 기기 설계를 그대로 쓴다', () => {
    const local = withSlots(prefs({ schoolId: SCHOOL.id, majors: ['cs'], univs: ['korea'] }), [])
    const m = mergeSaved({ prefs: {}, schools: [], plans: [] }, { ...local, schools: [SCHOOL] })!
    expect(m.prefs.slot).toBe(local.prefs.slot)
    expect(m.prefs.univs).toEqual(['korea'])
    expect(m.slots.map((s) => s.id)).toEqual([local.prefs.slot])
  })

  it('슬롯이 생기기 전 계정(설계안만 있음)도 고른 게 있으면 계정 설계를 연다', () => {
    const old = { prefs: prefs({ schoolId: SCHOOL.id, majors: ['cs'], univs: ['yonsei'] }), schools: [], plans: [slot('p-old', 'A안')] }
    const m = mergeSaved(old, { prefs: prefs(), schools: [SCHOOL], slots: [] })!
    expect(m.prefs.univs).toEqual(['yonsei'])
    expect(m.slots.map((s) => s.name)).toEqual(['슬롯 1', 'A안'])
    expect(m.prefs.slot).toBe(m.slots[0].id)
  })
})

describe('슬롯 이름', () => {
  it('비어 있는 이름을 고른다', () => {
    expect(unusedSlotName([])).toBe('슬롯 1')
    expect(unusedSlotName([{ name: '슬롯 1' }, { name: '슬롯 3' }])).toBe('슬롯 2')
    expect(unusedSlotName([{ name: 'A안 복사' }], 'A안 복사')).toBe('A안 복사 2')
    expect(unusedSlotName([], '아주 긴 이름을 가진 설계안이라서 서른 글자를 넘는 복사')).toHaveLength(30)
  })

  it('조사: 받침과 숫자 읽기에 맞춘다', () => {
    expect(josa('슬롯 1', '을', '를')).toBe('을')
    expect(josa('슬롯 2', '을', '를')).toBe('를')
    expect(josa('슬롯 10', '을', '를')).toBe('을')
    expect(josa('컴퓨터 A안', '을', '를')).toBe('을')
    expect(josa('공유받은 설계', '을', '를')).toBe('를')
  })
})

// ---- 계정과 합치기: 마지막으로 맞춘 기준(base)에 견준다 ----

const OTHER = normalizeSchool(emptySchool({ id: 'my-other', name: '다른고등학교', region: '부산', cohort: 2026 }))
const MINE = normalizeSchool(SCHOOL)

/** 지금 슬롯이 열린 상태 (prefs의 설계 = 그 슬롯) */
const stateOf = (slots: Slot[], active: string, schools: School[] = [MINE], extra: Partial<Prefs> = {}): LocalState => {
  const open = slots.find((s) => s.id === active)!
  return { prefs: prefs({ ...designOf(open), at: open.at, slot: active, ...extra }), schools, slots }
}
/** 계정에 저장된 모양 (서버가 돌려주는 data) */
const saved = (s: LocalState) => JSON.parse(JSON.stringify(payloadOf(s)))
/** s를 rev 판으로 맞췄을 때의 기준 */
const baseOf = (s: LocalState, rev = '2026-10-23T00:00:00.000Z') => snapshotOf(s, 1, rev, hashText(JSON.stringify(payloadOf(s))))
const T0 = '2026-10-20T00:00:00.000Z'
const T1 = '2026-10-23T01:00:00.000Z'
const T2 = '2026-10-23T02:00:00.000Z'

describe('계정 설계 합치기 (기준이 있을 때)', () => {
  const synced = stateOf([slot('s-1', '슬롯 1', { at: T0 }), slot('s-2', '의약 B안', { majors: ['med'], at: T0 })], 's-1', [MINE, OTHER])
  const base = baseOf(synced)

  it('이 기기에서 고치고 아직 못 올린 것은 계정의 예전 것에 덮이지 않는다', () => {
    // 700ms 안에 탭을 닫았거나 저장이 실패한 동안 고친 것
    const edited = slot('s-1', '슬롯 1', { majors: ['cs', 'med'], univs: ['snu', 'yonsei'], pinned: ['기하'], at: T1 })
    const local = stateOf([edited, synced.slots[1]], 's-1', [MINE, OTHER])
    const m = mergeSaved(saved(synced), local, base)!
    expect(m.prefs.majors).toEqual(['cs', 'med'])
    expect(m.prefs.pinned).toEqual(['기하'])
    expect(m.slots.find((s) => s.id === 's-1')!.univs).toEqual(['snu', 'yonsei'])
  })

  it('다른 기기에서 고친 것은 이 기기 것이 그대로면 받아 온다', () => {
    const remote = stateOf([slot('s-1', '슬롯 1', { univs: ['korea'], at: T1 }), synced.slots[1]], 's-1', [MINE, OTHER])
    const m = mergeSaved(saved(remote), synced, base)!
    expect(m.prefs.univs).toEqual(['korea'])
    // 합친 결과가 계정 것과 같으면 다시 올릴 것이 없다
    expect(hashText(JSON.stringify(payloadOf(m)))).toBe(hashText(JSON.stringify(payloadOf(remote))))
  })

  it('양쪽에서 같은 슬롯을 고쳤으면 나중에 고친 쪽이 이긴다', () => {
    const mine = stateOf([slot('s-1', '슬롯 1', { univs: ['yonsei'], at: T2 }), synced.slots[1]], 's-1', [MINE, OTHER])
    const theirs = stateOf([slot('s-1', '슬롯 1', { univs: ['korea'], at: T1 }), synced.slots[1]], 's-1', [MINE, OTHER])
    expect(mergeSaved(saved(theirs), mine, base)!.prefs.univs).toEqual(['yonsei'])
    const older = stateOf([slot('s-1', '슬롯 1', { univs: ['yonsei'], at: T1 }), synced.slots[1]], 's-1', [MINE, OTHER])
    const newer = stateOf([slot('s-1', '슬롯 1', { univs: ['korea'], at: T2 }), synced.slots[1]], 's-1', [MINE, OTHER])
    expect(mergeSaved(saved(newer), older, base)!.prefs.univs).toEqual(['korea'])
  })

  it('다른 기기에서 지운 슬롯·편제표는 이 기기의 예전 사본에서 되살아나지 않는다', () => {
    const remote = stateOf([synced.slots[0]], 's-1', [MINE])
    const m = mergeSaved(saved(remote), synced, base)!
    expect(m.slots.map((s) => s.id)).toEqual(['s-1'])
    expect(m.schools.map((s) => s.id)).toEqual([MINE.id])
    // 그래서 계정에 다시 올릴 것도 없다
    expect(hashText(JSON.stringify(payloadOf(m)))).toBe(hashText(JSON.stringify(payloadOf(remote))))
  })

  it('다른 기기에서 지웠어도 이 기기에서 그 뒤에 고친 슬롯은 남긴다', () => {
    const remote = stateOf([synced.slots[0]], 's-1', [MINE, OTHER])
    const local = stateOf([synced.slots[0], slot('s-2', '의약 B안', { majors: ['med'], univs: ['korea'], at: T1 })], 's-1', [MINE, OTHER])
    expect(mergeSaved(saved(remote), local, base)!.slots.map((s) => s.id)).toEqual(['s-1', 's-2'])
  })

  it('이 기기에서 새로 만든 슬롯·편제표는 계정에 없어도 남긴다 (빈 슬롯도)', () => {
    const created = normalizeSchool(emptySchool({ id: 'my-new', name: '새고등학교', region: '서울', cohort: 2026 }))
    const local = stateOf([...synced.slots, slot('s-3', '빈 슬롯', { majors: [], univs: [], at: T1 })], 's-1', [created, MINE, OTHER])
    const m = mergeSaved(saved(synced), local, base)!
    expect(m.slots.map((s) => s.id)).toEqual(['s-1', 's-2', 's-3'])
    expect(m.schools.map((s) => s.id)).toContain('my-new')
  })

  it('이 기기에서 지운 슬롯은 계정에 그대로 남아 있어도 다시 생기지 않는다', () => {
    const local = stateOf([synced.slots[0]], 's-1', [MINE])
    const m = mergeSaved(saved(synced), local, base)!
    expect(m.slots.map((s) => s.id)).toEqual(['s-1'])
    expect(m.schools.map((s) => s.id)).toEqual([MINE.id])
  })

  it('원서 후보: 다른 기기에서 비웠으면 비우고, 양쪽에서 담았으면 모두 둔다', () => {
    const withPicks = { ...synced, prefs: { ...synced.prefs, picks: ['snu:a'] } }
    const b = baseOf(withPicks)
    const cleared = { ...withPicks, prefs: { ...withPicks.prefs, picks: [] } }
    expect(mergeSaved(saved(cleared), withPicks, b)!.prefs.picks).toEqual([])
    const theirs = { ...withPicks, prefs: { ...withPicks.prefs, picks: ['snu:b'] } }
    const mine = { ...withPicks, prefs: { ...withPicks.prefs, picks: ['snu:a', 'korea:c'] } }
    expect(mergeSaved(saved(theirs), mine, b)!.prefs.picks).toEqual(['snu:b', 'snu:a', 'korea:c'])
  })

  it('열 슬롯: 이 기기에서 바꿨으면 이 기기 것, 아니면 계정에서 보던 것', () => {
    const switched = stateOf(synced.slots, 's-2', [MINE, OTHER])
    expect(mergeSaved(saved(synced), switched, base)!.prefs.slot).toBe('s-2')
    const remoteSwitched = stateOf(synced.slots, 's-2', [MINE, OTHER])
    expect(mergeSaved(saved(remoteSwitched), synced, base)!.prefs.slot).toBe('s-2')
  })

  it('이 기기 설계가 그 기준에서 이어진 것이 아니면 기준을 쓰지 않는다 (계정을 비우지 않게)', () => {
    // 로그아웃해 비어 있던 탭이 다른 탭이 남긴 기준으로 합치는 경우: 계정 것이 모두 '이 기기에서 지운 것'으로 보이면 안 된다
    const blank = stateOf([slot('s-blank', '슬롯 1', { schoolId: '', majors: [], univs: [] })], 's-blank', [])
    const m = mergeSaved(saved(synced), blank, base)!
    expect(m.slots.map((s) => s.id)).toEqual(['s-1', 's-2'])
    expect(m.schools.map((s) => s.id)).toEqual([MINE.id, OTHER.id])
    // 고른 것은 있지만 기준과 겹치는 슬롯이 없는 설계도 마찬가지
    const unrelated = stateOf([slot('s-x', '다른 설계', { univs: ['korea'] })], 's-x', [MINE])
    const m2 = mergeSaved(saved(synced), unrelated, base)!
    expect(m2.slots.map((s) => s.id)).toEqual(['s-1', 's-2', 's-x'])
    expect(m2.schools.map((s) => s.id)).toContain(OTHER.id)
  })

  it('특별 자격은 계정에 올리지 않고, 합칠 때도 이 기기 것을 둔다', () => {
    const local = { ...synced, prefs: { ...synced.prefs, profile: { ...EMPTY_PROFILE, special: ['equity' as const] } } }
    expect(JSON.stringify(payloadOf(local))).not.toContain('equity')
    expect(mergeSaved(saved(synced), local, base)!.prefs.profile.special).toEqual(['equity'])
  })
})

describe('슬롯이 넘칠 때 (말없이 버리지 않는다)', () => {
  it('계정 9개 + 이 기기에만 있던 3개: 10개만 남기고 뺀 이름을 돌려준다', () => {
    const remote = stateOf(
      Array.from({ length: 9 }, (_, i) => slot(`r-${i}`, `원격 ${i}`)),
      'r-0',
    )
    const local = stateOf(
      Array.from({ length: 3 }, (_, i) => slot(`l-${i}`, `이 기기 ${i}`)),
      'l-0',
    )
    const m = mergeSaved(saved(remote), local)!
    expect(m.slots).toHaveLength(MAX_SLOTS)
    expect(m.dropped).toEqual(['이 기기 1', '이 기기 2'])
  })

  it('열 슬롯은 넘쳐도 남긴다', () => {
    const remote = stateOf(
      Array.from({ length: 10 }, (_, i) => slot(`r-${i}`, `원격 ${i}`)),
      'r-0',
    )
    const local = stateOf([...remote.slots.slice(0, 1), slot('l-0', '이 기기')], 'l-0')
    const m = mergeSaved(saved(remote), local, baseOf(stateOf(remote.slots.slice(0, 1), 'r-0')))!
    expect(m.slots).toHaveLength(MAX_SLOTS)
    expect(m.slots.some((s) => s.id === 'l-0')).toBe(true)
    expect(m.prefs.slot).toBe('l-0')
    expect(m.dropped).toEqual(['원격 9'])
  })

  it('가리키는 슬롯이 없고 10개가 차 있으면 고른 게 없는 슬롯부터 비킨다', () => {
    const full = Array.from({ length: 10 }, (_, i) =>
      slot(`s-${i}`, `슬롯 ${i}`, { at: `2026-10-${10 + i}T00:00:00.000Z`, ...(i === 4 ? { majors: [], univs: [], schoolId: '' } : {}) }),
    )
    const r = withSlots(prefs({ schoolId: SCHOOL.id, majors: ['med'], univs: ['snu'], slot: 'gone' }), full)
    expect(r.slots).toHaveLength(MAX_SLOTS)
    expect(r.slots.some((s) => s.id === 's-4')).toBe(false)
    expect(r.dropped).toEqual([])
    // 빈 슬롯이 없으면 가장 오래 고치지 않은 슬롯을 빼고 이름을 알린다
    const busy = full.map((s) => ({ ...s, majors: ['cs'] }))
    const r2 = withSlots(prefs({ schoolId: SCHOOL.id, majors: ['med'], univs: ['snu'], slot: 'gone' }), busy)
    expect(r2.slots).toHaveLength(MAX_SLOTS)
    expect(r2.dropped).toEqual(['슬롯 0'])
  })
})

describe('계정에 올리는 내용', () => {
  it('키 순서가 달라도 내용이 같으면 같은 글이고, 서버가 받는 길이로 자른다', () => {
    const a = stateOf([slot('s-1', '슬롯 1')], 's-1')
    const reordered = { ...a, prefs: Object.fromEntries(Object.entries(a.prefs).reverse()) as unknown as Prefs }
    expect(JSON.stringify(payloadOf(reordered))).toBe(JSON.stringify(payloadOf(a)))
    const many = { ...a, prefs: { ...a.prefs, majors: Array.from({ length: 150 }, (_, i) => `m${i}`) } }
    expect(payloadOf(many).prefs.majors).toHaveLength(100)
  })

  it('예전 계정(슬롯 없음)도 학교를 그대로 연다', () => {
    const old = { prefs: prefs({ schoolId: SCHOOL.id, majors: ['cs'], univs: ['yonsei'] }), schools: [SCHOOL], plans: [] }
    const m = mergeSaved(old, { prefs: prefs(), schools: [], slots: [] })!
    expect(m.prefs.schoolId).toBe(SCHOOL.id)
    expect(m.slots).toHaveLength(1)
  })

  it('계정 설계가 설계 모양이 아니면 합치지 않는다', () => {
    expect(mergeSaved(null, stateOf([slot('s-1', '슬롯 1')], 's-1'))).toBeNull()
    expect(mergeSaved([], stateOf([slot('s-1', '슬롯 1')], 's-1'))).toBeNull()
  })
})

describe('공유받은 편제표 두기', () => {
  const verified = { ...MINE, shared: { id: 7, at: '2026-10-01', verified: true } }
  const crafted = schoolFromLoose(
    { terms: [{ id: '2-1', fixed: [{ subject: '가짜과목', credits: 30 }], groups: [] }] },
    { id: MINE.id, name: MINE.name, region: MINE.region, cohort: MINE.cohort },
  )

  it('같은 id인데 내용이 다르면 내 편제표를 덮지 않고 새 id로 둔다', () => {
    const r = placeShared(crafted, [verified], new Set([verified.id]))
    expect(r.school.id).not.toBe(MINE.id)
    expect(r.school.id.startsWith('shared-')).toBe(true)
    expect(r.schools.find((s) => s.id === MINE.id)).toBe(verified)
    expect(r.schools).toHaveLength(2)
  })

  it('같은 id에 내용도 같으면 내 것(확인 표시 포함)을 그대로 쓴다', () => {
    const r = placeShared({ ...MINE, shared: undefined }, [verified], new Set())
    expect(r.school).toBe(verified)
    expect(r.schools).toEqual([verified])
  })

  it('편제표 내용 비교는 묶음 id를 보지 않는다', () => {
    const a = schoolFromLoose(
      { terms: [{ id: '2-1', groups: [{ label: '탐구', pick: 2, credits: 3, options: ['물리학', '화학', '생명과학'] }] }] },
      { id: 'x', name: 'x', region: '', cohort: 2026 },
    )
    const b = { ...a, terms: a.terms.map((t) => ({ ...t, groups: t.groups.map((g) => ({ ...g, id: 'other-id' })) })) }
    expect(curriculumKey(b)).toBe(curriculumKey(a))
    expect(curriculumKey(normalizeSchool(normalizeSchool(a)))).toBe(curriculumKey(a))
  })
})
