import data from './adiga2028.json'
import type { University, Unit } from './schema'

// 대교협 자료집에서 옮긴 대학·모집단위 (scripts/build-adiga.mjs로 다시 만든다)

export const ADIGA_SOURCE = data.source

export const ADIGA_UNIVERSITIES: University[] = data.universities.map((u) => ({
  id: u.id,
  name: u.name,
  short: u.short,
  region: u.region,
  coverage: 'official',
  // 대학 입학처가 따로 낸 공식 자료에서 옮긴 대학은 그 출처, 아니면 대교협 자료집 쪽수
  sources: [
    'source' in u && u.source
      ? (u.source as { title: string; url: string; date: string })
      : {
          ...data.source,
          title: u.pages.length ? `${data.source.title} ${u.pages[0] === u.pages[1] ? u.pages[0] : `${u.pages[0]}~${u.pages[1]}`}쪽` : data.source.title,
        },
    ...('extra' in u && Array.isArray(u.extra) ? (u.extra as { title: string; url: string; date: string }[]) : []),
  ],
  checked: 'checked' in u && typeof u.checked === 'string' ? u.checked : '2026-10-19',
  policy:
    'policy' in u && typeof u.policy === 'string'
      ? u.policy
      : u.general
        ? `${'source' in u && u.source ? '대학 안내' : '자료집 안내'}: ${u.general}`
        : '자료집에 이 대학의 공통 안내가 없어요. 반영 방식은 대학 입학처 모집요강을 확인하세요.',
  ...('caveat' in u && typeof u.caveat === 'string' ? { caveat: u.caveat } : {}),
}))

export const ADIGA_UNITS: Unit[] = data.units

/** 자료집이 아니라 대학이 따로 낸 공식 자료에서 옮긴 대학 */
export const ADIGA_OWN_SOURCE: University[] = ADIGA_UNIVERSITIES.filter((u) => u.sources[0].url !== data.source.url)
