import { MAJOR_BY_ID } from '../src/data/majors'
import { UNIV_BY_ID } from '../src/data/universities'

// 계정에 올린 설계가 바뀐 곳을 사람이 읽는 줄로 바꾼다 (관리자 화면 '사용자 로그'에 남긴다).
// 화면이 보낸 값이라 모양을 믿지 않고, 아는 값만 이름으로 바꾼다. 같은 내용을 다시 올린 것은 줄을 만들지 않는다.

export interface DesignChange {
  action: string
  /** 어느 설계에서 한 일인지 (슬롯 이름, 원서 후보, 내 조건, 학교) */
  target: string
  detail: string
}

type Obj = Record<string, unknown>
const obj = (x: unknown): Obj => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Obj) : {})
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : [])
const strs = (x: unknown): string[] => list(x).filter((v): v is string => typeof v === 'string')
/** id가 있는 항목만 (편제표·슬롯) */
const withId = (x: unknown): Obj[] =>
  list(x)
    .map(obj)
    .filter((o) => typeof o.id === 'string' && o.id !== '')
const text = (x: unknown, max = 40) =>
  typeof x === 'string'
    ? x
        .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : ''

/** 더하고 뺀 것: '+ 가, + 나, - 다' (많으면 앞 8개만) */
function delta(before: string[], after: string[], name: (s: string) => string): string {
  const b = new Set(before)
  const a = new Set(after)
  const parts = [...after.filter((x) => !b.has(x)).map((x) => `+ ${name(x)}`), ...before.filter((x) => !a.has(x)).map((x) => `- ${name(x)}`)]
  return parts.length > 8 ? `${parts.slice(0, 8).join(', ')} 외 ${parts.length - 8}` : parts.join(', ')
}

const num = (x: unknown) => (typeof x === 'number' ? x : Number(x) || 0)
/**
 * 편제표 내용: 학기별 과목·학점, 선택 칸(이름·고르는 수·학점·과목), 두 학기 세트만 견준다.
 * 칸 id·필드 순서·출처 같은 꼬리표는 화면이 편제표를 정리하면서 바뀔 수 있어, 그것만 바뀐 것은 고친 것으로 보지 않는다
 */
const content = (s: Obj) =>
  JSON.stringify([
    list(s.terms)
      .map(obj)
      // 과목이 없는 빈 학기는 화면이 채워 넣기도 해서 견주지 않는다
      .filter((t) => list(t.fixed).length > 0 || list(t.groups).length > 0)
      .map((t) => [
        text(t.id, 8),
        list(t.fixed)
          .map(obj)
          .map((f) => `${text(f.subject)}:${num(f.credits)}${f.alt ? `/${text(f.alt)}` : ''}`)
          .sort(),
        list(t.groups)
          .map(obj)
          .map(
            (g) =>
              `${text(g.label)}|${num(g.pick)}|${num(g.credits)}|${strs(g.options)
                .map((o) => text(o))
                .sort()
                .join(',')}`,
          )
          .sort(),
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    list(s.tracks)
      .map(obj)
      .map((tr) => [
        text(tr.label),
        list(tr.sets)
          .map(obj)
          .map((set) => [
            text(set.label),
            list(set.items)
              .map(obj)
              .map((i) => `${text(i.term, 8)}:${text(i.subject)}:${num(i.credits)}`)
              .sort(),
          ]),
      ]),
  ])

/** 앞서 저장한 설계와 새 설계를 견줘 사용자가 한 일을 줄로 만든다 */
export function designChanges(before: unknown, after: unknown): DesignChange[] {
  const B = obj(before)
  const A = obj(after)
  const bp = obj(B.prefs)
  const ap = obj(A.prefs)
  const bSchools = withId(B.schools)
  const aSchools = withId(A.schools)
  const schoolName = (id: unknown) => text([...aSchools, ...bSchools].find((s) => s.id === id)?.name) || '이름 없는 학교'
  const bSlots = withId(B.plans)
  const aSlots = withId(A.plans)
  const slotName = (s: Obj | undefined) => text(s?.name, 30)
  const target = slotName(aSlots.find((s) => s.id === ap.slot)) || '설계'
  const out: DesignChange[] = []
  const add = (action: string, detail: string, where = target) => {
    if (detail) out.push({ action, target: where, detail })
  }

  // 슬롯: 새로 만들기·지우기·이름 바꾸기·열기
  for (const s of aSlots) if (!bSlots.some((x) => x.id === s.id)) add('design.slot', `새 슬롯 '${slotName(s)}'`, slotName(s) || target)
  for (const s of bSlots) if (!aSlots.some((x) => x.id === s.id)) add('design.slot', `슬롯 지움 '${slotName(s)}'`, slotName(s) || target)
  for (const s of aSlots) {
    const old = bSlots.find((x) => x.id === s.id)
    if (old && slotName(old) !== slotName(s)) add('design.slot', `이름 '${slotName(old)}' → '${slotName(s)}'`, slotName(s) || target)
  }
  const switched = bp.slot !== ap.slot
  if (switched && bSlots.some((x) => x.id === ap.slot)) add('design.slot', `슬롯 열기 '${target}'`)

  // 지금 슬롯의 설계 (다른 슬롯을 열었으면 그 슬롯의 설계로 바뀐 것이라 남기지 않는다)
  if (!switched) {
    if (bp.schoolId !== ap.schoolId)
      add('design.school', ap.schoolId ? `${bp.schoolId ? `${schoolName(bp.schoolId)} → ` : ''}${schoolName(ap.schoolId)}` : '학교 비움')
    add(
      'design.majors',
      delta(strs(bp.majors), strs(ap.majors), (id) => MAJOR_BY_ID.get(id)?.name ?? text(id)),
    )
    add(
      'design.univs',
      delta(strs(bp.univs), strs(ap.univs), (id) => UNIV_BY_ID.get(id)?.short ?? text(id)),
    )
    if (JSON.stringify(bp.unitIds ?? null) !== JSON.stringify(ap.unitIds ?? null))
      add('design.units', Array.isArray(ap.unitIds) ? `학과 ${ap.unitIds.length}곳만 고름` : '학과 모두')
    add(
      'design.pin',
      delta(strs(bp.pinned), strs(ap.pinned), (s) => text(s)),
    )
    add(
      'design.exclude',
      delta(strs(bp.excluded), strs(ap.excluded), (s) => text(s)),
    )
    if (bp.focus !== ap.focus && typeof ap.focus === 'string') add('design.focus', `${text(bp.focus) || '없음'} → ${text(ap.focus)}`)
    if (!!bp.keepAll !== !!ap.keepAll) add('design.keepAll', ap.keepAll ? '켬' : '끔')
  }

  // 모든 슬롯이 같이 쓰는 것: 원서 후보, 내 조건.
  // 원서 후보는 개수와 대학만 남기고 전형 이름은 남기지 않는다 (기회균형·농어촌처럼 지원 자격이 드러나는 전형이 있어서)
  const bPicks = [...new Set(strs(bp.picks))]
  const aPicks = [...new Set(strs(ap.picks))]
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((k) => y.includes(k))
  if (!same(bPicks, aPicks)) {
    const univs = (keys: string[]) => [...new Set(keys.map((k) => k.split(':')[0]))]
    const moved = delta(univs(bPicks), univs(aPicks), (id) => UNIV_BY_ID.get(id)?.short ?? text(id))
    add('design.picks', `${bPicks.length}개 → ${aPicks.length}개${moved ? ` (${moved})` : ''}`, '원서 후보')
  }
  const bf = obj(bp.profile)
  const af = obj(ap.profile)
  const profile = [
    text(bf.status) !== text(af.status) ? text(af.status) : '',
    text(bf.schoolType) !== text(af.schoolType) ? `고교 유형 ${text(af.schoolType) || '학교 정보대로'}` : '',
    text(bf.region) !== text(af.region) ? `지역 ${text(af.region) || '학교 정보대로'}` : '',
    ((t) => (t ? `관심 전형 ${t}` : ''))(delta(strs(bf.types), strs(af.types), (x) => text(x))),
  ].filter(Boolean)
  add('design.profile', profile.join(' · '), '내 조건')

  // 학교 편제표: 직접 넣거나 고친 것, 지운 것 (학교를 고르며 함께 저장한 것은 학교 고르기 줄로 충분하다)
  for (const s of aSchools) {
    const old = bSchools.find((x) => x.id === s.id)
    const name = text(s.name) || '이름 없는 학교'
    if (!old && !(ap.schoolId === s.id && bp.schoolId !== s.id)) add('design.curriculum', '편제표 저장', name)
    else if (old && content(old) !== content(s)) add('design.curriculum', '편제표 고침', name)
  }
  for (const s of bSchools) if (!aSchools.some((x) => x.id === s.id)) add('design.curriculum', '편제표 지움', text(s.name) || '이름 없는 학교')
  return out
}
