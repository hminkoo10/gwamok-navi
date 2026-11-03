// 나이스 교육정보 개방 포털: 학교 검색, 학과·과정 목록. 인증키가 없으면 결과가 5건으로 제한된다.

export interface SchoolHit {
  office: string
  code: string
  name: string
  region: string
  address: string
  homepage: string
  /** 일반고·특성화고·특목고·자율고 */
  type: string
  /** 전형 지원 자격에 쓰는 고교 유형 (특목고를 과학고·외고·예술고·마이스터고 등으로 나눔) */
  schoolType: string
}

interface NeisRow {
  ATPT_OFCDC_SC_CODE?: string
  ATPT_OFCDC_SC_NM?: string
  SD_SCHUL_CODE?: string
  SCHUL_NM?: string
  ORG_RDNMA?: string
  HMPG_ADRES?: string
  HS_SC_NM?: string
  /** 특수목적고등학교 계열명 (과학계열·외국어계열·국제계열·예술계열·체육계열·산업수요맞춤형) */
  SPCLY_PURPS_HS_ORD_NM?: string
  /** 설립 구분 (국립·공립·사립) */
  FOND_SC_NM?: string
}

/** 나이스 고교 구분·특목고 계열 → 전형 자격용 고교 유형. 모르면 빈 문자열 */
export function schoolTypeOf(hs: string | undefined, special: string | undefined, fond?: string): string {
  const kind = (hs ?? '').trim()
  const sp = (special ?? '').trim()
  if (kind === '일반고') return '일반고'
  // 전형 자격의 '자율고'는 자율형 사립고. 자율형 공립고는 일반고로 본다
  if (kind === '자율고') return (fond ?? '').includes('공립') || (fond ?? '').includes('국립') ? '일반고' : '자율고'
  if (kind === '특성화고') return '특성화고'
  if (kind === '특목고') {
    if (/산업수요|마이스터/.test(sp)) return '마이스터고'
    if (/과학/.test(sp)) return '과학고'
    if (/외국어/.test(sp)) return '외고'
    if (/국제/.test(sp)) return '국제고'
    if (/예술/.test(sp)) return '예술고'
    if (/체육/.test(sp)) return '체육고'
  }
  return ''
}

/** '경기도교육청' → '경기'. 시도가 합쳐진 곳은 나이스가 옛 시도를 괄호로 적음: '전남광주통합특별시교육청(광주)' → '광주' */
export const regionOf = (office: string) => /\(([^()]+)\)\s*$/.exec(office)?.[1].trim() || office.replace(/(특별자치|특별|광역)?(시|도)?교육청$/, '').trim()

export async function searchSchools(q: string, key: string | undefined, fetchImpl: typeof fetch = fetch): Promise<SchoolHit[]> {
  const params = new URLSearchParams({ Type: 'json', pIndex: '1', pSize: '10', SCHUL_KND_SC_NM: '고등학교', SCHUL_NM: q })
  if (key) params.set('KEY', key)
  const res = await fetchImpl(`https://open.neis.go.kr/hub/schoolInfo?${params}`, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`neis ${res.status}`)
  const data = (await res.json()) as { schoolInfo?: [unknown, { row?: NeisRow[] }] }
  neisResult(data)
  const rows = data.schoolInfo?.[1]?.row ?? []
  const homepage = (u: string | undefined) => {
    if (!u) return ''
    const url = /^https?:\/\//i.test(u) ? u : `http://${u}`
    try {
      return new URL(url).toString()
    } catch {
      return ''
    }
  }
  return rows
    .filter((r) => r.SD_SCHUL_CODE && r.SCHUL_NM)
    .map((r) => ({
      office: r.ATPT_OFCDC_SC_CODE ?? '',
      code: r.SD_SCHUL_CODE ?? '',
      name: r.SCHUL_NM ?? '',
      region: regionOf(r.ATPT_OFCDC_SC_NM ?? ''),
      address: r.ORG_RDNMA ?? '',
      homepage: homepage(r.HMPG_ADRES),
      type: r.HS_SC_NM ?? '',
      schoolType: schoolTypeOf(r.HS_SC_NM, r.SPCLY_PURPS_HS_ORD_NM, r.FOND_SC_NM),
    }))
}

/** 학과로 따로 묻지 않는 이름 (일반 학급) */
const GENERIC_TRACK = /^(일반학과|보통과|일반과|공통|공통과정|일반과정|인문사회과정|자연과정|인문과정|일반|일반계|보통)$/

/** 학과·과정 이름 정리 (서버 trackOf와 같은 글자만) */
const cleanName = (n: string | undefined) =>
  (n ?? '')
    .replace(/[^\p{L}\p{N} ·()-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30)

export interface SchoolTracks {
  /** 학과·과정 이름 (일반 학급 제외) */
  tracks: string[]
  /** 학과별 그 학년 학급 수 (학급 정보로 알았을 때) */
  classes: Record<string, number>
  /** 일반 학급도 있는 학교 (일반고의 체육 학급처럼) */
  general: boolean
  /** 일반 학급 수 (학급 정보로 알았을 때) */
  generalClasses?: number
  /** classes: 그 해 학급 정보, majors: 학교 학과 정보 (예전 학과가 섞일 수 있음) */
  source: 'classes' | 'majors' | 'none'
}

/** 학년도. 3월 시작, 한국 시간 기준 */
export function schoolYear(now = new Date()): number {
  const kst = new Date(now.getTime() + 9 * 3600_000)
  return kst.getUTCMonth() >= 2 ? kst.getUTCFullYear() : kst.getUTCFullYear() - 1
}

type Row = { DDDEP_NM?: string; ORD_SC_NM?: string; GRADE?: string; CLASS_NM?: string }

/**
 * 나이스는 오류도 HTTP 200과 결과 코드로 알린다. INFO-200(해당 자료 없음)만 '없음'이고
 * 인증키·트래픽 한도·서버 오류 같은 나머지 코드는 던진다 (잠깐의 오류를 빈 결과로 하루 동안 기억하지 않게)
 */
export function neisResult(data: unknown): void {
  const code = data && typeof data === 'object' ? (data as { RESULT?: { CODE?: unknown } }).RESULT?.CODE : undefined
  if (typeof code === 'string' && code !== 'INFO-200') throw new Error(`neis ${code}`)
}

async function neisRows(service: string, params: Record<string, string>, key: string | undefined, fetchImpl: typeof fetch): Promise<Row[]> {
  const q = new URLSearchParams({ Type: 'json', pIndex: '1', pSize: '300', ...params })
  if (key) q.set('KEY', key)
  const res = await fetchImpl(`https://open.neis.go.kr/hub/${service}?${q}`, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`neis ${res.status}`)
  const data = (await res.json()) as Record<string, [unknown, { row?: Row[] }] | undefined>
  neisResult(data)
  return data[service]?.[1]?.row ?? []
}

/**
 * 학교의 학과·과정 목록. 특성화고·특목고뿐 아니라 일반고에도 체육·예술 학급처럼 편제표가 따로인 학급이 있다.
 * 1) 그 입학년도 학생이 올해 다니는 학년의 학급 정보로 지금 있는 학과를 본다 (예비 고1은 올해 1학년).
 * 2) 학급 정보가 없으면 학교 학과 정보 (없어진 예전 학과가 섞일 수 있음).
 */
export async function schoolTracks(
  office: string,
  code: string,
  cohort: number,
  key: string | undefined,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<SchoolTracks> {
  const base = { ATPT_OFCDC_SC_CODE: office, SD_SCHUL_CODE: code }
  const year = schoolYear(now)
  // 예비 고1은 올해 1학년 학급
  const grade = Math.min(3, Math.max(1, year - cohort + 1))
  // 학급 정보가 없을 때만 학과 정보로. 나이스 오류는 그대로 던진다 (덜 맞는 결과를 하루 동안 기억하지 않게)
  const rows: Row[] = year - cohort + 1 <= 3 ? await neisRows('classInfo', { ...base, AY: String(year), GRADE: String(grade) }, key, fetchImpl) : []
  if (rows.length) {
    const classes: Record<string, number> = {}
    let generalClasses = 0
    for (const r of rows) {
      const name = cleanName(r.DDDEP_NM)
      if (!name || GENERIC_TRACK.test(name)) {
        generalClasses++
        continue
      }
      classes[name] = (classes[name] ?? 0) + 1
    }
    const tracks = Object.keys(classes).sort((a, b) => a.localeCompare(b, 'ko'))
    return { tracks, classes, general: generalClasses > 0 || !tracks.length, generalClasses, source: 'classes' }
  }
  const majors = await neisRows('schoolMajorinfo', base, key, fetchImpl)
  const names = majors.map((r) => cleanName(r.DDDEP_NM)).filter(Boolean)
  const tracks = [...new Set(names.filter((n) => !GENERIC_TRACK.test(n)))].sort((a, b) => a.localeCompare(b, 'ko'))
  return { tracks, classes: {}, general: names.some((n) => GENERIC_TRACK.test(n)) || !tracks.length, source: majors.length ? 'majors' : 'none' }
}
