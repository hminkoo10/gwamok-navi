import { upgradeMajors } from '../data/majors'
import type { School } from '../data/schema'
import { BANSONG_2026 } from '../data/schools/bansong2026'
import { SUBJECT_BY_NAME } from '../data/subjects'
import { UNIT_BY_ID } from '../data/units'
import { UNIV_BY_ID } from '../data/universities'
import { schoolFromLoose } from '../engine/school'

// 공유 링크: 고른 상태를 압축해 주소의 # 뒤에 넣는다. 서버에 아무것도 저장하지 않는다.
// 링크는 누구나 만들 수 있으므로 열 때 모든 값을 다시 검사한다.

export interface ShareState {
  majors: string[]
  /** 목표 대학 (v1 링크에는 없어서 모집단위에서 거꾸로 구한다) */
  univs: string[]
  units: string[]
  school: School
  pinned: string[]
  excluded: string[]
}

const MAX_DECODED = 60_000

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const body = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(body).arrayBuffer())
}

export async function encodeShare(state: ShareState): Promise<string> {
  const json = JSON.stringify({ v: 2, ...state })
  const packed = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'))
  return toBase64Url(packed)
}

export async function decodeShare(code: string): Promise<ShareState | null> {
  try {
    if (code.length > 20_000) return null
    const bytes = await pipe(fromBase64Url(code), new DecompressionStream('deflate-raw'))
    if (bytes.length > MAX_DECODED) return null
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
    if (raw.v !== 1 && raw.v !== 2) return null
    const strings = (x: unknown, ok: (s: string) => boolean) =>
      Array.isArray(x) ? [...new Set(x.filter((s): s is string => typeof s === 'string' && ok(s)))].slice(0, 200) : []
    let school: School
    if (raw.school && typeof raw.school === 'object') {
      const s = raw.school as Record<string, unknown>
      const text = (x: unknown, max: number) => (typeof x === 'string' ? x.trim().slice(0, max) : '')
      const cohort = typeof s.cohort === 'number' && s.cohort > 2000 && s.cohort < 2100 ? Math.round(s.cohort) : 2026
      const track = text(s.track, 30).replace(/[^\p{L}\p{N} ·()-]/gu, '')
      // 나이스 학교 코드로 만든 id면 그대로 둬서 같은 학교가 두 번 저장되지 않게 한다
      const id = /^neis-[A-Z]\d{2}-\d{7}-\d{4}(-[\p{L}\p{N} ·()-]{1,30})?$/u.test(text(s.id, 80))
        ? text(s.id, 80)
        : `shared-${text(s.name, 30) || 'school'}-${cohort}`
      school = {
        ...schoolFromLoose(s, { id, name: text(s.name, 30) || '공유받은 학교', region: text(s.region, 20), cohort }),
        ...(track ? { track } : {}),
      }
    } else {
      // 예전 링크는 반송고 예시 편제표를 썼다. 실제 반송고 나이스 id를 쓰면 그 학교를 불러온 사람의 편제표와 섞이므로 따로 둔다
      school = { ...BANSONG_2026, id: `shared-${BANSONG_2026.name}-${BANSONG_2026.cohort}` }
    }
    const anySubject = (s: string) => s.length <= 40 && (SUBJECT_BY_NAME.has(s) || /^[\p{L}\p{N} ·()Ⅰ-Ⅳ-]+$/u.test(s))
    const units = strings(raw.units, (s) => UNIT_BY_ID.has(s))
    const univs = raw.v === 2 ? strings(raw.univs, (s) => UNIV_BY_ID.has(s)) : [...new Set(units.map((id) => UNIT_BY_ID.get(id)!.univ))]
    return {
      majors: upgradeMajors(strings(raw.majors, (s) => s.length <= 40)),
      univs: univs.slice(0, 60),
      units,
      school,
      pinned: strings(raw.pinned, anySubject),
      excluded: strings(raw.excluded, anySubject),
    }
  } catch {
    return null
  }
}
