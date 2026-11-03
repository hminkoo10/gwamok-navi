import { useEffect } from 'react'
import { JOINT_BY_SIDO, JOINT_CHECKED, JOINT_NATIONAL } from '../data/joint'
import { DATA_DATE } from '../data/meta'
import { SIDO } from '../engine/admissions'
import { UNIT_COUNT, UNITS } from '../data/units'
import { ADIGA_OWN_SOURCE } from '../data/adiga'
import { EXCLUDED_NOTE, UNIVERSITIES } from '../data/universities'
import { useApp } from '../lib/app'
import { COVERAGE_LABEL } from '../lib/format'
import { Link } from '../components/Link'

const FAQ: [string, string][] = [
  [
    '권장과목이 뭔가요?',
    '대학이 학과마다 "이 과목을 들어 오면 좋겠다"고 발표한 고등학교 과목이에요. 핵심과목은 특히 중요하다고 본 과목, 권장과목은 들으면 좋은 과목이에요.',
  ],
  [
    '권장과목을 안 들으면 지원할 수 없나요?',
    '아니요. 지원 자격이 아니에요. 다만 여러 대학이 학생부 평가에서 이수 여부를 본다고 밝혔어요. 학교에 과목이 없어 못 들은 경우는 따로 고려한다고 밝힌 대학도 있어요.',
  ],
  [
    '우리 학교에 없는 과목은 어떻게 하나요?',
    '공동교육과정(여러 학교가 함께 여는 수업)이나 시도교육청 온라인학교로 들을 수 있어요. 신청은 보통 다니는 학교를 거쳐서 하니 담임 선생님이나 교육과정 담당 선생님께 먼저 물어보세요. 아래 "학교에 없는 과목 듣기"에 시도별 주소를 모아 뒀어요.',
  ],
  ['특성화고·특목고도 쓸 수 있나요?', '네. 학교를 고르면 학과 목록이 나와요. 다니는 학과를 고르면 그 학과 편제표로 계산해요.'],
  ['우리 학교 편제표를 못 찾았어요.', '학교 홈페이지 교육과정 게시판에서 편제표 파일(PDF·한글·엑셀·사진)을 받아 올리면 표로 옮겨요. 직접 입력해도 돼요.'],
  ['불러온 편제표가 틀려요.', '내 과목 설계의 출처 탭에서 틀린 곳을 알려 주세요. 시작하기의 저장된 학교에서 표를 열어 직접 고칠 수도 있어요.'],
  ['입학년도는 어떻게 고르나요?', '고등학교에 들어간 해를 고르세요. 같은 학교라도 입학년도마다 편제표가 달라요.'],
  [
    '지원 가능·확인 필요·지원 불가는 어떻게 정하나요?',
    '대학이 시행계획에 적은 지원 자격(졸업 여부, 고교 유형, 지역, 특별 자격, 학교장 추천)을 다니는 학교와 내 조건에 맞춰 봐요. 서류로 확인하는 자격이나 학교장 추천이 필요한 전형은 확인 필요로 보여 줘요. 최종 자격은 대학 모집요강에서 확인하세요.',
  ],
  [
    '원서 후보는 어떻게 쓰나요?',
    '전형 찾기나 대학 페이지에서 전형 오른쪽의 담기를 누르면 원서 후보에 모여요. 수시 6번·정시 3번을 넘는지, 지금 조건으로 지원할 수 없는 전형이나 같은 대학 중복 지원은 없는지 알려 줘요.',
  ],
  [
    '대입 정보는 언제 바뀌나요?',
    '대학이 시행계획을 고치거나 모집요강을 내면 확인해서 반영해요. 목표 대학 자료가 바뀌면 화면 위에 알림이 뜨고, 바뀐 내용은 대입 정보 소식에서 볼 수 있어요.',
  ],
  [
    '분야를 더 좁혀서 고를 수 있나요?',
    '네. 분야마다 세부 학과(예: 컴퓨터공학, 소프트웨어, 반도체·디스플레이)를 따로 고를 수 있어요. "게임을 만들고 싶어요"처럼 하고 싶은 일을 문장으로 적으면 AI가 맞는 세부 학과를 골라 줘요. 공과대학·자연계열 전체처럼 넓게 뽑는 모집단위는 어느 세부 학과를 골라도 함께 나와요.',
  ],
  [
    '목표 전형을 바꾸면 무엇이 달라지나요?',
    '전형마다 학생부를 보는 방식이 달라서 권장과목을 넣는 학과가 달라져요. 서류(학생부 정성평가)로 과목 이수를 보는 곳은 권장과목을 채우고, 교과 성적만 보거나 수능·논술 점수만 보는 곳은 권장과목을 조건에서 빼요. 정시는 2028 수능 출제 과목을, 논술은 대학 출제 범위 과목을 더해요. 수시도 함께 준비하면 "뺀 학과의 권장과목도 함께 채우기"를 켜세요.',
  ],
  [
    '빈칸의 "추천"은 어떻게 정하나요?',
    '전국의 같은 분야 학과들이 권장과목으로 많이 적은 과목이에요. 모든 분야에서 흔한 과목은 점수를 낮추고, 다른 계열이 섞인 학과는 덜 세고, 한 곳만 권한 과목은 내지 않아요. 앞 과목을 먼저 듣는 순서도 지켜요. 대학 자료에 없는 전문교과는 과목 이름으로 진로와 가까운지 봐요. "원하는 과목 직접 고르기"에서 과목을 찾아 바로 넣거나 뺄 수 있어요.',
  ],
  [
    '정시 반영 비율 표는 어떻게 보나요?',
    '대학이 모집단위 묶음(인문·자연·의예 등)마다 수능 영역을 몇 %씩 반영하는지예요. 진하게 표시한 영역이 가장 많이 반영돼요. 비율 합이 100%를 넘으면 영역 가운데 성적이 좋은 것만 골라 반영한다는 뜻이에요. 영어·한국사 점수표와 산출식은 표 아래를 펼치면 보여요.',
  ],
  [
    '"내 학과 n명"은 무엇인가요?',
    '고른 분야의 학과가 그 전형으로 몇 명을 뽑는지예요. 대학 시행계획의 모집단위별 인원표에서 옮겼고, 표를 옮긴 대학에서만 보여요. "인원 미정"은 그 전형으로 뽑기는 하지만 학과별 인원이 따로 없다는 뜻이에요. 약간명만 뽑거나, 수시에서 못 채운 인원만 넘겨 뽑거나, 계열 단위로 함께 뽑는 경우예요. 전형 찾기에서 "내 학과를 뽑는 전형만"을 켜면 내 학과를 뽑지 않는 전형을 숨겨요.',
  ],
  [
    '설계를 여러 개 저장해 두고 비교하고 싶어요.',
    '내 과목 설계 맨 위 슬롯 줄을 쓰세요. "새 슬롯"에서 빈 슬롯을 열거나 지금 설계를 복사하고, 슬롯 이름을 눌러 오가면 돼요. 슬롯마다 학교·분야·대학·학과·꼭 듣기/빼기·목표 전형을 따로 저장하고, 고친 내용은 지금 슬롯에 바로 저장돼요. 내 조건과 원서 후보는 모든 슬롯이 같이 써요. 슬롯은 10개까지 만들 수 있어요.',
  ],
  [
    '처음부터 다시 고르고 싶어요.',
    '내 과목 설계의 "초기화"를 누르세요. 꼭 듣기·빼기만 지워 추천대로 되돌리거나, 지금 슬롯의 분야·대학·학과·목표 전형까지 모두 비울 수 있어요. 학교 편제표와 다른 슬롯은 그대로이고, 초기화한 바로 뒤에는 아래 알림의 "되돌리기"로 되돌릴 수 있어요.',
  ],
  [
    '꼭 가입해야 하나요?',
    '네. 과목내비는 Google 계정으로 로그인해야 써요. 처음 로그인할 때 이름(실명)을 적고, 만 14세 이상인지와 개인정보 수집에 동의를 받아요. 고른 학교와 설계는 계정에 저장돼 다른 기기에서도 이어서 볼 수 있어요.',
  ],
  [
    '어떻게 가입하나요?',
    'Google 계정으로 로그인하면 돼요. 처음 로그인하면 이름(실명)을 적고 만 14세 이상인지와 개인정보 수집에 동의하면 바로 가입돼요. 따로 비밀번호를 만들지 않으니, Google 계정에 로그인할 수 있으면 언제든 들어올 수 있어요.',
  ],
]

const TERMS: [string, string][] = [
  ['편제표', '학년·학기별로 어떤 과목을 몇 학점 듣는지 정한 학교 교육과정 표. 학교마다, 입학년도마다 달라요.'],
  ['선택 칸', '편제표에서 "3과목 선택"처럼 여러 과목 중 몇 개를 고르는 묶음. 같은 칸 안에서는 정해진 개수만 들을 수 있어요.'],
  ['일반선택·진로선택·융합선택', '2022 개정 교육과정의 선택과목 구분. 대학 권장과목은 주로 수학·과학의 일반선택과 진로선택에 몰려 있어요.'],
  ['학과(모집단위)', '대학이 학생을 뽑는 단위. 학과·학부·전공 이름으로 나뉘어 있어요.'],
  ['앞 과목', '먼저 들으면 좋은 과목. 예를 들어 역학과 에너지는 물리학을 먼저 들으면 좋아요.'],
  ['공동교육과정', '학생 수가 적거나 교사가 없어 학교에서 못 여는 과목을 여러 학교가 함께 여는 수업이에요.'],
  [
    '수시 6번·정시 3번',
    '수시는 대학·전형을 합쳐 6번, 정시는 가·나·다군에 한 번씩 3번까지 지원할 수 있어요. 과학기술원·사관학교·경찰대학 같은 특별법 대학과 산업대·전문대는 이 횟수에 들어가지 않아요.',
  ],
  ['수능 최저학력기준', '수시 전형에서 합격하려면 수능에서 받아야 하는 최소 등급. "3합 7"은 정해진 세 영역 등급의 합이 7 이내여야 한다는 뜻이에요.'],
]

export function HelpPage() {
  const { features } = useApp()
  const ai = features.ai
  const counts = {
    official: UNIVERSITIES.filter((u) => u.coverage === 'official').length,
    other: UNIVERSITIES.filter((u) => u.coverage !== 'official').length,
  }

  // 다른 페이지의 '자료 출처' 같은 링크로 들어오면 그 칸으로 내려간다
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView()
  }, [])

  return (
    <div className="wrap page help">
      <header className="page-head">
        <h1 className="page-title">도움말</h1>
        <p className="page-sub">과목내비가 무엇을 계산하는지, 자료는 어디서 왔는지 정리했어요.</p>
      </header>

      <nav className="toc" aria-label="목차">
        <a href="#faq">자주 묻는 질문</a>
        <a href="#terms">용어 풀이</a>
        <a href="#joint">학교에 없는 과목 듣기</a>
        <a href="#sources">자료 출처</a>
        <a href="#school-data">학교 편제표를 가져오는 방법</a>
        <a href="#privacy">개인정보 안내</a>
        {features.userKey && <Link to="/help/gemini-key">Gemini API 키 발급 방법</Link>}
      </nav>

      <section id="faq" className="help-section">
        <h2 className="section-title">자주 묻는 질문</h2>
        <div className="faq">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section id="terms" className="help-section">
        <h2 className="section-title">용어 풀이</h2>
        <dl className="terms">
          {TERMS.map(([t, d]) => (
            <div key={t}>
              <dt>{t}</dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="joint" className="help-section">
        <h2 className="section-title">학교에 없는 과목 듣기</h2>
        <p>
          시도교육청마다 온라인학교와 공동교육과정을 운영해요. 온라인학교는 따로 입학하는 학교가 아니라, 다니는 학교에 적을 둔 채 과목만 듣는 곳이에요. 학점은
          다니는 학교에서 인정해요.
        </p>
        <ul className="joint-list">
          {SIDO.map((sido) => {
            const j = JOINT_BY_SIDO[sido]
            const links = [j?.online, j?.joint].filter((x) => x !== undefined)
            return (
              <li key={sido}>
                <strong>{sido}</strong>
                <span>
                  {links.map((l, i) => (
                    <span key={l.url}>
                      {i > 0 && ' · '}
                      <a href={l.url} target="_blank" rel="noreferrer noopener">
                        {l.name}
                      </a>
                    </span>
                  ))}
                </span>
              </li>
            )
          })}
        </ul>
        <p className="muted">
          전국 안내는{' '}
          <a href={JOINT_NATIONAL.joint.url} target="_blank" rel="noreferrer noopener">
            고교학점제 홈페이지
          </a>
          에 있어요. 주소는 {JOINT_CHECKED}에 확인했어요. 전남온라인학교는 확인한 날 접속이 되지 않아 뺐어요.
        </p>
      </section>

      <section id="sources" className="help-section">
        <h2 className="section-title">자료 출처</h2>
        <p>
          대학 {UNIVERSITIES.length}곳이 들어 있고, 그중 {UNIVERSITIES.filter((u) => UNIT_COUNT.get(u.id)).length}곳의 학과{' '}
          {UNITS.length.toLocaleString('ko-KR')}개에 권장과목이 있어요. 나머지는 2028학년도 학과별 권장과목을 밝히지 않았거나 공식 자료를 찾지 못한 대학이라,
          무엇을 확인했는지만 보여 줘요.{' '}
          {counts.other ? `공식 자료 ${counts.official}곳, 그 밖의 자료 ${counts.other}곳이에요.` : '모두 대학이나 대교협이 낸 공식 자료예요.'}
        </p>
        <ul className="plain-list">
          <li>
            대교협 대입정보포털 「2028 모집단위별 반영과목 및 대학별 권장과목 자료집」(2025-12-18)에 실린 대학. 자료집은 대학들이 대입정보포털에 올린 원본
            파일을 모아 정리한 것이라, 원본과 한 줄씩 다시 대조해(2026-10-21) 다르게 옮겨진 곳(빠진 학과, 바뀐 과목, 핵심·권장 구분)은 대학 원본을 따랐어요.
          </li>
          <li>연세대: 입학처 「2028학년도 전공연계과목 선택 가이드라인」(2026-04), 중앙대: 입학처 학문단위별 이수 권장과목 안내(2025-09)</li>
          <li>
            성균관대: 「2028학년도 학생부종합전형 서류평가 개요」(대입정보포털), 서강대: 입학처 「2028학년도 모집단위별 반영과목 안내」(2025-08-29). 두 대학
            모두 학과별 권장과목을 두지 않는다고 밝혔어요.
          </li>
          {ADIGA_OWN_SOURCE.length > 0 && (
            <li>
              자료집에 없어서 대학이 따로 낸 자료로 넣은 대학:{' '}
              {ADIGA_OWN_SOURCE.map((u, i) => (
                <span key={u.id}>
                  {i > 0 && ', '}
                  <a href={u.sources[0].url} target="_blank" rel="noreferrer noopener">
                    {u.sources[0].title}
                  </a>{' '}
                  ({u.sources[0].date})
                </span>
              ))}
            </li>
          )}
        </ul>
        <p className="muted">{EXCLUDED_NOTE}</p>
        <details className="source-table">
          <summary>대학별 출처 보기</summary>
          <ul>
            {UNIVERSITIES.map((u) => (
              <li key={u.id}>
                <Link to={`/universities/${u.id}`}>{u.name}</Link>
                <span className="muted"> · {COVERAGE_LABEL[u.coverage]}</span>
              </li>
            ))}
          </ul>
        </details>
        <p className="muted">자료 기준일 {DATA_DATE}. 대학이 기준을 바꿀 수 있으니 지원 전에는 대학 입학처 공지를 확인하세요.</p>
      </section>

      <section id="school-data" className="help-section">
        <h2 className="section-title">학교 편제표를 가져오는 방법</h2>
        <ol className="plain-list">
          <li>다른 사람이 이미 불러온 학교면 저장된 편제표를 바로 줘요.</li>
          <li>
            처음 보는 학교면 학교알리미 공시(「학교교육과정 편성·운영 및 평가에 관한 사항」, 모든 학교가 매년 4월 공시)와 학교 홈페이지 교육과정 게시판에서
            편제표 파일을 찾아요.
          </li>
          <li>찾은 파일(PDF·한글·엑셀·그림·홈페이지 표)을 서버가 받아 {ai ? '생성형 AI로 ' : ''}과목과 학점을 옮겨요. 학과를 고른 경우 그 학과 표만 옮겨요.</li>
          <li>제대로 읽혔는지 학기별 학점으로 확인하고, 이상하면 저장하지 않고 직접 고치게 해요.</li>
        </ol>
        <p>
          학교 홈페이지는 robots.txt가 허용하는 곳만 읽고, AI 처리를 막아 둔 홈페이지는 읽지 않아요. 학교알리미는 모든 접근을 허용하고 있어요. 자동으로 옮긴
          표는 틀릴 수 있으니 원문과 함께 확인하세요.
        </p>
      </section>

      <section id="privacy" className="help-section">
        <h2 className="section-title">개인정보 안내</h2>
        <ul className="plain-list">
          <li>과목내비는 Google 계정으로 로그인해야 써요. 고른 학교·분야·대학과 편제표는 계정에 저장하고, 빨리 열리게 이 기기의 브라우저에도 함께 둬요.</li>
          <li>
            가입하면 이름(실명), Google 계정 고유 번호와 이메일 주소, 계정에 저장한 설계, 가입·로그인 시각을 보관해요. 사진·전화번호와 Google 비밀번호는 받지
            않아요. 로그인, 여러 기기에서 설계 이어 보기, 계정 관리에만 쓰고, 이름은 관리자만 봐요. 탈퇴하면 바로 지워요.
          </li>
          <li>
            이용 기록: 가입·로그인·로그아웃, 과목 설계에서 바꾼 것(학교·분야·대학 고르기, 꼭 듣기·빼기, 목표 전형, 슬롯, 원서 후보, 내 조건), 편제표
            찾기·불러오기·자동 읽기, 파일 올려 읽기, 문장으로 분야 찾기, 편제표 신고를 언제 했는지 남겨요. 서비스 운영과 부정 이용을 막는 데에만 쓰고 관리자만
            봐요. 올린 파일과 적은 문장의 내용, IP 주소는 남기지 않아요. 1년이 지나면 지우고, 탈퇴하면 누가 했는지 알 수 없게 바꿔요.
          </li>
          <li>
            로그아웃하면 이 기기에 남은 설계를 지워요 (같이 쓰는 컴퓨터에 남지 않게). 계정에는 그대로 남아 있어요. 브라우저를 닫아도 로그아웃되지 않으니, 같이
            쓰는 컴퓨터에서는 꼭 로그아웃하세요.
          </li>
          <li>만 14세 이상만 가입할 수 있어요.</li>
          <li>공유 링크에는 고른 설정과 학교 편제표만 담겨요.</li>
          {features.userKey && (
            <li>
              지금은 편제표 자동 읽기·파일 읽기·문장으로 찾기를 각자 등록한 Google AI Studio(Gemini) API 키로 해요. 등록한 키는 암호화해서 보관하고, 이 기능을
              쓸 때만 Google로 보내요. 내 계정에서 언제든 지울 수 있고 탈퇴하면 바로 지워요.
            </li>
          )}
          <li>
            학교 편제표를 자동으로 불러오면 그 학교 편제표가 서버에 남아 다른 사람도 쓸 수 있어요. 누가 불러왔는지는 다른 사람에게 보이지 않고 이용 기록에만
            남아요.
          </li>
          {ai && <li>직접 올린 파일이나 적은 문장은 읽기 위해 외부 AI 서비스로 보내고, 이 서버에는 저장하지 않아요.</li>}
          {ai && features.aiTraining && (
            <li>
              지금은 외부 AI로 Google Gemini API 무료 등급을 써요. 보낸 내용과 답을 Google이 제품·모델 개선에 쓰고, Google의 검토자가 읽을 수 있어요.
              이름·연락처 같은 개인정보는 적거나 올리지 마세요.
            </li>
          )}
        </ul>
      </section>
    </div>
  )
}
