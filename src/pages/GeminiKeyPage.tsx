import type { ReactNode } from 'react'
import { Link } from '../components/Link'
import { useApp } from '../lib/app'

// Google AI Studio에서 Gemini API 키를 만들어 과목내비에 등록하는 방법.
// 2026년 10월 Google 안내(ai.google.dev/gemini-api/docs/api-key, Gemini API 추가 약관 2026-03-23 시행) 기준.

const STUDIO = 'https://aistudio.google.com/apikey'
const DOCS = 'https://ai.google.dev/gemini-api/docs/api-key?hl=ko'
const TERMS = 'https://ai.google.dev/gemini-api/terms?hl=ko'

const STEPS: [string, ReactNode][] = [
  [
    'Google AI Studio 열기',
    <>
      <a href={STUDIO} target="_blank" rel="noreferrer noopener">
        aistudio.google.com/apikey
      </a>
      에 들어가 Google 계정으로 로그인해요. 처음이면 서비스 약관에 동의하라는 창이 나와요.
    </>,
  ],
  [
    'API 키 만들기',
    "API 키 페이지에서 'API 키 만들기(Create API key)'를 눌러요. 처음 쓰는 사람은 약관에 동의할 때 기본 프로젝트와 키가 이미 만들어지기도 해요. 그러면 그 키를 쓰면 돼요.",
  ],
  ['프로젝트 고르기', '어느 프로젝트에 만들지 물으면 기본 프로젝트를 고르거나 새 프로젝트를 만들어요. 프로젝트 이름은 아무거나 괜찮아요.'],
  ['키 복사하기', '만들어진 키를 복사해요. 영문과 숫자가 섞인 긴 문자열이에요. 다른 사람에게 보내거나 채팅·게시판에 올리지 마세요.'],
  [
    '과목내비에 등록하기',
    "내 계정의 '내 Gemini API 키'에 붙여 넣고 '확인하고 등록'을 눌러요. 과목내비가 짧은 질문 하나로 키가 맞는지 확인한 뒤 암호화해서 저장해요.",
  ],
]

const TROUBLE: [string, string][] = [
  [
    "'API 키 만들기'가 눌리지 않아요",
    "'이 프로젝트에서 키를 만들 권한이 없습니다'가 나오면 그 프로젝트에 키를 만들 권한이 없는 거예요. 학교나 회사에서 받은 계정이면 개인 Google 계정으로 해 보거나, 조직과 연결되지 않은 새 프로젝트를 만들어 그 안에 키를 만드세요.",
  ],
  [
    '등록할 때 맞지 않는 키라고 나와요',
    "키를 끝까지 복사했는지, 앞뒤에 빈칸이 들어가지 않았는지 보세요. AI Studio에서 그 키를 지웠거나 '차단됨'으로 표시돼 있으면 새 키를 만들어 등록하세요.",
  ],
  ['사용 한도에 걸렸다고 나와요', '무료 등급은 1분과 하루에 보낼 수 있는 요청 수가 정해져 있어요. 1분쯤 뒤에 다시 해 보고, 계속 안 되면 다음 날 다시 하세요.'],
]

/** Gemini API 키 발급 방법 (로그인 없이도 볼 수 있음) */
export function GeminiKeyPage() {
  const { features, user } = useApp()
  return (
    <div className="wrap page help guide">
      <header className="page-head">
        <p className="eyebrow">도움말</p>
        <h1 className="page-title">Gemini API 키 발급 방법</h1>
        <p className="page-sub">편제표 자동 읽기·파일 읽기·문장으로 찾기를 내 Google AI Studio API 키로 쓰는 방법이에요. 키는 무료로 만들 수 있어요.</p>
      </header>

      {!features.userKey && (
        <p className="callout">지금은 과목내비가 서버의 AI를 써서 키를 등록하지 않아도 돼요. 관리자가 '사용자 키로 AI 쓰기'를 켜면 필요해요.</p>
      )}

      <section id="before" className="help-section">
        <h2 className="section-title">먼저 확인하세요</h2>
        <ul className="plain-list">
          <li>Google 계정이 있어야 해요. 학교나 회사에서 받은 계정은 관리자가 막아 두었을 수 있어 개인 계정이 편해요.</li>
          <li>무료로 써요. 결제 정보(Cloud Billing)를 연결하지 않으면 요금이 나오지 않고, 무료 한도를 넘으면 잠시 막혔다가 다시 돼요.</li>
          <li>
            무료 등급에서는 보낸 내용과 답을 Google이 제품 개선에 쓰고, Google의 검토자가 읽을 수 있어요. 이름·연락처 같은 개인정보가 담긴 파일이나 문장은
            보내지 마세요.
          </li>
        </ul>
      </section>

      <section id="steps" className="help-section">
        <h2 className="section-title">키 만들기</h2>
        <ol className="guide-steps">
          {STEPS.map(([title, body], i) => (
            <li key={title}>
              <span className="step-no num">{i + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="guide-action">
          {user ? (
            <Link to="/account#ai-key" className="btn btn-primary">
              내 계정에서 키 등록하기
            </Link>
          ) : (
            <Link to="/login?next=%2Faccount" className="btn btn-primary">
              로그인하고 키 등록하기
            </Link>
          )}
        </p>
      </section>

      <section id="manage" className="help-section">
        <h2 className="section-title">키 관리</h2>
        <ul className="plain-list">
          <li>키는 비밀번호와 같아요. 키가 새면 다른 사람이 내 무료 한도를 써 버릴 수 있어요.</li>
          <li>키가 샜다고 생각되면 AI Studio의 API 키 페이지에서 그 키를 지우고 새로 만든 뒤, 과목내비에 새 키를 다시 등록하세요.</li>
          <li>과목내비에서 키를 지우려면 내 계정의 '내 Gemini API 키'에서 지우기를 누르세요. 탈퇴하면 바로 지워져요.</li>
          <li>과목내비는 키를 암호화해서 보관하고, 편제표 읽기·파일 읽기·문장으로 찾기를 할 때만 Google로 보내요. 화면에는 끝 4자리만 보여요.</li>
        </ul>
      </section>

      <section id="trouble" className="help-section">
        <h2 className="section-title">잘 안 될 때</h2>
        <div className="faq">
          {TROUBLE.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <p className="fine guide-foot">
        2026년 10월 Google 안내를 기준으로 썼어요. Google 화면은 바뀔 수 있어요. 자세한 내용은 Google의{' '}
        <a href={DOCS} target="_blank" rel="noreferrer noopener">
          Gemini API 키 안내
        </a>
        와{' '}
        <a href={TERMS} target="_blank" rel="noreferrer noopener">
          Gemini API 추가 약관
        </a>
        을 보세요.
      </p>
    </div>
  )
}
