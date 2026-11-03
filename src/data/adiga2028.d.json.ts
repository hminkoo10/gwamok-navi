// scripts/build-adiga.mjs가 만드는 adiga2028.json의 모양. JSON을 직접 타입 추론하지 않게 따로 적는다.
import type { Source, Unit } from './schema'

declare const data: {
  source: Source
  universities: {
    id: string
    name: string
    short: string
    region: string
    /** 자료집 인쇄 쪽 번호 [처음, 끝] */
    pages: number[]
    /** 대학 공통 안내 문장 (없으면 빈 문자열) */
    general: string
  }[]
  units: Unit[]
}

export default data
