// 대입 일정: 대교협 「대학입학전형기본사항」 전문의 모집 시기별 일정, 수능 시험일·성적 통지일, 학생부 작성 기준일.
// 기본사항은 입학 2년 전 8월 말에 나온다 (2029학년도 = 2026-08-28). 새 학년도가 나오면 SCHEDULES에 더한다.

export interface Milestone {
  /** 시작일 (YYYY-MM-DD) */
  start: string
  /** 끝나는 날 (하루짜리면 없음) */
  end?: string
  label: string
  group: '수시' | '정시' | '추가' | '수능'
  note?: string
}

export interface Schedule {
  /** 학년도 */
  year: number
  source: { title: string; url: string }
  /** 시작일 순 */
  items: Milestone[]
}

export const SCHEDULES: Schedule[] = [
  {
    year: 2028,
    source: {
      title: '대교협 「2028학년도 대학입학전형기본사항」 (2025-08-28 발표, 2026-07-31 개정)',
      url: 'https://www.kcue.or.kr/news/sub02/sub01.php?at=view&idx=2764740',
    },
    items: [
      { start: '2027-08-31', label: '학생부 작성 기준일 (수시)', group: '수시', note: '이날까지 적힌 학생부로 수시를 봐요' },
      { start: '2027-09-20', end: '2027-09-23', label: '수시 원서접수 (이 중 3일 이상)', group: '수시' },
      { start: '2027-09-24', end: '2027-12-20', label: '수시 전형 기간 (면접·논술·실기)', group: '수시' },
      { start: '2027-11-18', label: '대학수학능력시험', group: '수능' },
      { start: '2027-11-30', label: '학생부 작성 기준일 (정시)', group: '정시' },
      { start: '2027-12-10', label: '수능 성적 통지', group: '수능' },
      { start: '2027-12-21', label: '수시 합격자 발표 마감', group: '수시' },
      { start: '2027-12-22', end: '2027-12-24', label: '수시 합격자 등록', group: '수시' },
      { start: '2027-12-26', end: '2027-12-31', label: '수시 미등록 충원', group: '수시', note: '합격 통보 30일 18시까지, 등록 31일 18시까지' },
      { start: '2028-01-03', end: '2028-01-06', label: '정시 원서접수 (이 중 3일 이상)', group: '정시' },
      { start: '2028-01-10', end: '2028-01-17', label: '정시 가군 전형', group: '정시' },
      { start: '2028-01-18', end: '2028-01-25', label: '정시 나군 전형', group: '정시' },
      { start: '2028-01-31', end: '2028-02-07', label: '정시 다군 전형', group: '정시' },
      { start: '2028-02-10', label: '정시 합격자 발표 마감', group: '정시' },
      { start: '2028-02-11', end: '2028-02-14', label: '정시 합격자 등록', group: '정시' },
      { start: '2028-02-15', end: '2028-02-21', label: '정시 미등록 충원', group: '정시', note: '합격 통보 20일 18시까지, 등록 21일 18시까지' },
      { start: '2028-02-22', end: '2028-02-29', label: '추가모집', group: '추가', note: '등록 마감 29일 20시' },
    ],
  },
  {
    year: 2029,
    source: {
      title: '대교협 「2029학년도 대학입학전형기본사항」 (2026-08-28 발표)',
      url: 'https://www.kcue.or.kr/news/sub02/sub01.php?at=view&idx=2765226',
    },
    items: [
      { start: '2028-08-31', label: '학생부 작성 기준일 (수시)', group: '수시', note: '이날까지 적힌 학생부로 수시를 봐요' },
      { start: '2028-09-18', end: '2028-09-21', label: '수시 원서접수 (이 중 3일 이상)', group: '수시' },
      { start: '2028-09-22', end: '2028-12-18', label: '수시 전형 기간 (면접·논술·실기)', group: '수시' },
      { start: '2028-11-16', label: '대학수학능력시험', group: '수능' },
      { start: '2028-11-30', label: '학생부 작성 기준일 (정시)', group: '정시' },
      { start: '2028-12-08', label: '수능 성적 통지', group: '수능' },
      { start: '2028-12-19', label: '수시 합격자 발표 마감', group: '수시' },
      { start: '2028-12-20', end: '2028-12-22', label: '수시 합격자 등록', group: '수시' },
      { start: '2028-12-23', end: '2028-12-29', label: '수시 미등록 충원', group: '수시', note: '합격 통보 28일 18시까지, 등록 29일 18시까지' },
      { start: '2029-01-02', end: '2029-01-05', label: '정시 원서접수 (이 중 3일 이상)', group: '정시' },
      { start: '2029-01-08', end: '2029-01-15', label: '정시 가군 전형', group: '정시' },
      { start: '2029-01-16', end: '2029-01-23', label: '정시 나군 전형', group: '정시' },
      { start: '2029-01-24', end: '2029-01-31', label: '정시 다군 전형', group: '정시' },
      { start: '2029-02-06', label: '정시 합격자 발표 마감', group: '정시' },
      { start: '2029-02-07', end: '2029-02-09', label: '정시 합격자 등록', group: '정시' },
      { start: '2029-02-14', end: '2029-02-20', label: '정시 미등록 충원', group: '정시', note: '합격 통보 19일 18시까지, 등록 20일 18시까지' },
      { start: '2029-02-21', end: '2029-02-28', label: '추가모집', group: '추가', note: '등록 마감 28일 20시' },
    ],
  },
]

/** 그 학년도 일정 (아직 발표 전이거나 없으면 undefined) */
export const scheduleFor = (year: number) => SCHEDULES.find((s) => s.year === year)

/** 지금 나와 있는 가장 늦은 학년도 일정 */
export const LATEST_SCHEDULE = SCHEDULES[SCHEDULES.length - 1]

/** 오늘(서울)부터 그날까지 남은 날 (지났으면 음수) */
export function daysUntil(date: string, now = new Date()): number {
  const today = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10)
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400_000)
}

/** 아직 시작하지 않은 첫 일정 (오늘 시작하는 것 포함) */
export function nextMilestone(items: Milestone[], now = new Date()): Milestone | null {
  return items.find((m) => daysUntil(m.start, now) >= 0) ?? null
}

/** 오늘 진행 중인 기간 */
export function ongoing(items: Milestone[], now = new Date()): Milestone[] {
  return items.filter((m) => m.end && daysUntil(m.start, now) < 0 && daysUntil(m.end, now) >= 0)
}

/** 입학년도로 본 대입 학년도 (2025년 입학 → 2028학년도) */
export const admissionYearOf = (cohort: number) => cohort + 3
