import type { School } from '../schema'

// 반송고등학교(경기 화성) 「2026학년도 입학생 교육과정 편제표(1학년)」를 그대로 옮겼다.
// 출처 PDF 3쪽. 과목명 옆 운영 표기(A/B/C)는 뜻이 편제표에 적혀 있지 않아 옮기지 않았다.

const SCHOOL_SOURCE = {
  title: '반송고등학교 「2026 교육과정 편제표」 (학교 홈페이지 교육과정 게시판, 2026-03-18 게시)',
  url: 'https://www.goehs.kr/upload/bansong-h/ba/2026/03/FA7B42B9-9305-58AA-929B-510EE86D16A8.pdf',
  date: '2026-03-11',
}

export const BANSONG_2026: School = {
  id: 'bansong-2026',
  name: '반송고등학교',
  region: '경기 화성',
  cohort: 2026,
  source: SCHOOL_SOURCE,
  checked: '2026-10-19',
  terms: [
    {
      id: '1-1',
      fixed: [
        { subject: '공통국어1', credits: 4 },
        { subject: '공통수학1', credits: 4 },
        { subject: '공통영어1', credits: 4 },
        { subject: '한국사1', credits: 3 },
        { subject: '통합사회1', credits: 3 },
        { subject: '통합과학1', credits: 3 },
        { subject: '과학탐구실험1', credits: 1 },
        { subject: '체육1', credits: 2 },
        { subject: '음악', credits: 2, alt: '미술' },
        { subject: '기술·가정', credits: 3, alt: '정보' },
      ],
      groups: [],
    },
    {
      id: '1-2',
      fixed: [
        { subject: '공통국어2', credits: 4 },
        { subject: '공통수학2', credits: 4 },
        { subject: '공통영어2', credits: 4 },
        { subject: '한국사2', credits: 3 },
        { subject: '통합사회2', credits: 3 },
        { subject: '통합과학2', credits: 3 },
        { subject: '과학탐구실험2', credits: 1 },
        { subject: '체육2', credits: 2 },
        { subject: '미술', credits: 2, alt: '음악' },
        { subject: '정보', credits: 3, alt: '기술·가정' },
      ],
      groups: [],
    },
    {
      id: '2-1',
      fixed: [
        { subject: '스포츠 문화', credits: 2 },
        { subject: '문학', credits: 4 },
        { subject: '대수', credits: 4 },
        { subject: '영어Ⅰ', credits: 4 },
      ],
      groups: [
        {
          id: '2-1-탐구',
          label: '사회·과학 탐구',
          pick: 3,
          credits: 3,
          options: ['현대사회와 윤리', '세계사', '사회와 문화', '정치', '세계시민과 지리', '물리학', '화학', '생명과학', '지구과학'],
        },
        {
          id: '2-1-교과영역간',
          label: '교과 영역 간 선택',
          pick: 1,
          credits: 3,
          options: ['주제 탐구 독서', '인공지능 수학', '미디어 영어', '로봇과 공학세계', '생활과학 탐구', '드로잉', '음악사'],
        },
      ],
    },
    {
      id: '2-2',
      fixed: [
        { subject: '스포츠 과학', credits: 2 },
        { subject: '화법과 언어', credits: 4 },
        { subject: '미적분Ⅰ', credits: 4 },
        { subject: '영어Ⅱ', credits: 4 },
      ],
      groups: [
        {
          id: '2-2-탐구',
          label: '사회·과학 탐구',
          pick: 3,
          credits: 3,
          options: ['윤리와 사상', '동아시아 역사 기행', '경제', '법과 사회', '도시의 미래 탐구', '역학과 에너지', '물질과 에너지', '세포와 물질대사', '지구시스템과학'],
        },
        {
          id: '2-2-교과영역간',
          label: '교과 영역 간 선택',
          pick: 1,
          credits: 3,
          options: ['주제 탐구 독서', '기하', '영미 문학 읽기', '로봇과 공학세계', '생활과학 탐구', '미술사', '음악사'],
        },
      ],
    },
    {
      id: '3-1',
      fixed: [
        { subject: '스포츠 생활1', credits: 2 },
        { subject: '독서와 작문', credits: 3 },
        { subject: '확률과 통계', credits: 3 },
        { subject: '영어 독해와 작문', credits: 3 },
        { subject: '사회문제 탐구', credits: 3, alt: '기후변화와 환경생태' },
      ],
      groups: [
        {
          id: '3-1-선택',
          label: '진로 선택',
          pick: 4,
          credits: 3,
          options: [
            '문학과 영상', '미적분Ⅱ', '경제 수학', '직무 영어', '인문학과 윤리', '역사로 탐구하는 현대 세계',
            '국제 관계의 이해', '여행지리', '한국지리 탐구', '전자기와 양자', '화학 반응의 세계', '생물의 유전',
            '행성우주과학', '인공지능 기초', '창의 공학 설계', '인간 발달', '조형 탐구', '음악 공연 실습',
          ],
        },
      ],
    },
    {
      id: '3-2',
      fixed: [
        { subject: '스포츠 생활2', credits: 2 },
        { subject: '독서 토론과 글쓰기', credits: 3 },
        { subject: '통합수학Ⅰ', credits: 3 },
        { subject: '심화 영어', credits: 3 },
        { subject: '기후변화와 환경생태', credits: 3, alt: '사회문제 탐구' },
      ],
      groups: [
        {
          id: '3-2-선택',
          label: '진로 선택',
          pick: 4,
          credits: 3,
          options: [
            '문학과 영상', '전문 수학', '세계 문화와 영어', '윤리문제 탐구', '역사로 탐구하는 현대 세계',
            '금융과 경제생활', '기후변화와 지속가능한 세계', '융합과학 탐구', '과학의 역사와 문화',
            '소프트웨어와 생활', '창의 공학 설계', '인간 발달', '미술 이론', '합창·합주',
          ],
        },
      ],
    },
  ],
  tracks: [
    {
      id: '2-제2외국어',
      label: '2학년 제2외국어 세트',
      sets: [
        { label: '세트1 일본어', items: [{ term: '2-1', subject: '일본어', credits: 3 }, { term: '2-2', subject: '일본어 회화', credits: 3 }] },
        { label: '세트2 중국어', items: [{ term: '2-1', subject: '중국어', credits: 3 }, { term: '2-2', subject: '중국어 회화', credits: 3 }] },
      ],
    },
    {
      id: '3-예술',
      label: '3학년 예술 세트',
      sets: [
        { label: '세트1 음악', items: [{ term: '3-1', subject: '음악 연주와 창작', credits: 3 }, { term: '3-2', subject: '음악 감상과 비평', credits: 3 }] },
        { label: '세트2 미술', items: [{ term: '3-1', subject: '미술 창작', credits: 3 }, { term: '3-2', subject: '미술 감상과 비평', credits: 3 }] },
      ],
    },
  ],
  notes: [
    '1학년 음악/미술, 기술·가정/정보는 집중이수라 학기를 나눠 둘 다 듣는다.',
    '3학년 사회문제 탐구/기후변화와 환경생태는 편제표에 두 학기 모두 짝으로 적혀 있어 집중이수로 옮겼다.',
    '편제표는 계획이라 수강 인원에 따라 폐강될 수 있다(2026학년도 2학년은 음악사·로봇과 공학세계 등이 폐강됨).',
  ],
}
