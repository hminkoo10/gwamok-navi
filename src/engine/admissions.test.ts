import { describe, expect, it } from 'vitest'
import type { AdmissionTrack } from '../data/schema'
import { contextOf, EMPTY_PROFILE, eligibility, sidoOf, subjectWeight } from './admissions'

const base: AdmissionTrack = {
  id: 't',
  name: '전형',
  type: '종합',
  period: '수시',
  quota: '정원내',
  seats: 100,
  grads: '졸업자포함',
  rec: null,
  schools: { only: [], exclude: [] },
  regions: [],
  special: [],
  who: '',
  method: '서류 100%',
  elements: ['서류'],
  min: null,
  subjects: null,
  note: null,
  pages: '1',
}
const track = (patch: Partial<AdmissionTrack>): AdmissionTrack => ({ ...base, ...patch })
const general = contextOf(EMPTY_PROFILE, { kind: '일반고', region: '경기 화성' })

describe('전형 지원 자격', () => {
  it('조건이 없으면 지원할 수 있다', () => {
    expect(eligibility(base, general)).toEqual({ status: 'ok', reasons: [] })
  })

  it('졸업예정자만 받는 전형은 졸업생이 못 낸다', () => {
    const grad = contextOf({ ...EMPTY_PROFILE, status: '졸업생' }, { kind: '일반고', region: '경기' })
    expect(eligibility(track({ grads: '예정자' }), grad).status).toBe('no')
    expect(eligibility(track({ grads: '예정자' }), general).status).toBe('ok')
  })

  it('지원 불가 고교 유형과 특성화고 대상 전형 (고려대 학교추천·특성화고전형처럼)', () => {
    const schoolRec = track({
      type: '교과',
      rec: { required: true, limit: '고교별 12명' },
      schools: { only: [], exclude: ['특성화고', '마이스터고', '예술고'] },
    })
    const vocational = track({
      type: '수능',
      period: '정시',
      quota: '정원외',
      schools: { only: ['특성화고', '마이스터고'], exclude: [] },
      special: ['vocational'],
    })
    const dimigo = contextOf(EMPTY_PROFILE, { kind: '특성화고', region: '경기' })
    expect(eligibility(schoolRec, dimigo)).toMatchObject({ status: 'no', reasons: expect.arrayContaining(['특성화고 학생은 지원할 수 없어요']) })
    expect(eligibility(schoolRec, general)).toEqual({ status: 'check', reasons: ['학교장 추천을 받아야 해요 (고교별 12명)'] })
    expect(eligibility(vocational, general).status).toBe('no')
    // 특성화고 학생은 학교 유형만으로 특성화고 대상 자격이 생긴다
    expect(eligibility(vocational, dimigo).status).toBe('check')
  })

  it('고교 유형을 모르면 확인 필요로 둔다', () => {
    const unknown = contextOf(EMPTY_PROFILE, { kind: '특목고', region: '서울' })
    expect(eligibility(track({ schools: { only: ['특성화고'], exclude: [] } }), unknown).status).toBe('check')
    // 내 조건에서 고르면 그것을 쓴다
    const art = contextOf({ ...EMPTY_PROFILE, schoolType: '예술고' }, { kind: '특목고', region: '서울' })
    expect(eligibility(track({ schools: { only: [], exclude: ['예술고'] } }), art).status).toBe('no')
  })

  it('지역인재: 고교 소재지가 맞아야 한다', () => {
    const local = track({ regions: ['부산', '울산', '경남'] })
    expect(eligibility(local, contextOf(EMPTY_PROFILE, { region: '부산' })).status).toBe('ok')
    expect(eligibility(local, general)).toMatchObject({ status: 'no' })
    expect(eligibility(local, contextOf(EMPTY_PROFILE, null)).status).toBe('check')
  })

  it('특별 자격은 그중 하나만 맞으면 되고, 서류 확인이 남는다', () => {
    const balance = track({ special: ['equity', 'rural', 'island'] })
    expect(eligibility(balance, general).status).toBe('no')
    const rural = contextOf({ ...EMPTY_PROFILE, special: ['rural'] }, { kind: '일반고', region: '전남' })
    expect(eligibility(balance, rural)).toEqual({ status: 'check', reasons: ['농어촌 학생 자격을 서류로 확인해요'] })
  })

  it('정해진 대상(그 밖의)은 판단하지 않고 확인을 부탁하고, 예체능 특기는 내 조건에서 고르게 한다', () => {
    const social = track({ special: ['multicultural', 'other'], who: '다문화·다자녀·군경 자녀 등' })
    expect(eligibility(social, general).status).toBe('check')
    const art = eligibility(track({ type: '실기', special: ['artist'] }), general)
    expect(art.status).toBe('no')
    expect(art.reasons[0]).toContain('내 조건에서 골라 주세요')
    const artist = contextOf({ ...EMPTY_PROFILE, special: ['artist'] }, { kind: '예술고', region: '서울' })
    expect(eligibility(track({ type: '실기', special: ['artist'] }), artist).status).toBe('check')
  })

  it('시도 이름을 맞춘다', () => {
    expect(sidoOf('경기 화성')).toBe('경기')
    expect(sidoOf('충청북도')).toBe('충북')
    expect(sidoOf('전북특별자치도')).toBe('전북')
    expect(sidoOf('서울특별시')).toBe('서울')
    expect(sidoOf('')).toBe('')
  })

  it('전남광주통합특별시는 옛 광주·전남으로 나눈다 (광주교대 전남교육감추천처럼 둘을 따로 보는 전형이 있다)', () => {
    // 나이스 교육청 이름 (2026년 현재)
    expect(sidoOf('전남광주통합특별시교육청(광주)')).toBe('광주')
    expect(sidoOf('전남광주통합특별시교육청(전남)')).toBe('전남')
    expect(sidoOf('전남광주통합특별시(광주)')).toBe('광주')
    // 주소: 옛 광주는 자치구, 전남은 시·군
    expect(sidoOf('전남광주통합특별시 북구 독립로237번길 33')).toBe('광주')
    expect(sidoOf('전남광주통합특별시 광산구')).toBe('광주')
    expect(sidoOf('전남광주통합특별시 목포시 산정로224번길 11')).toBe('전남')
    expect(sidoOf('전남광주통합특별시 화순군')).toBe('전남')
    // 가를 수 없으면 모른다고 둔다 (지역인재 전형은 '확인 필요'가 된다)
    expect(sidoOf('전남광주통합특별시')).toBe('')
    expect(sidoOf('전라남도')).toBe('전남')
    expect(sidoOf('광주광역시')).toBe('광주')

    const jeonnamOnly = track({ regions: ['전남'] })
    expect(eligibility(jeonnamOnly, contextOf(EMPTY_PROFILE, { region: '전남광주통합특별시교육청(광주)' })).status).toBe('no')
    expect(eligibility(jeonnamOnly, contextOf(EMPTY_PROFILE, { region: '전남광주통합특별시교육청(전남)' })).status).toBe('ok')
    expect(eligibility(jeonnamOnly, contextOf(EMPTY_PROFILE, { region: '전남광주통합특별시' })).status).toBe('check')
  })

  it('전형 유형별로 과목 선택이 얼마나 중요한지', () => {
    expect(subjectWeight(base).level).toBe('높음')
    expect(subjectWeight(track({ type: '교과', elements: ['교과'] })).level).toBe('낮음')
    expect(subjectWeight(track({ type: '교과', elements: ['교과', '서류'] })).level).toBe('보통')
  })
})
