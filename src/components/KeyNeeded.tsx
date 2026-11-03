import { Link } from './Link'

/** '사용자 키로 AI 쓰기'가 켜졌는데 내 Gemini API 키가 없을 때 AI 기능 자리에 띄우는 등록·발급 안내 */
export function KeyNeeded({ what, other }: { what: string; other?: string }) {
  return (
    <div className="callout key-needed">
      <p>
        <strong>{what}</strong>는 내 Google AI Studio(Gemini) API 키로 해요. 키를 내 계정에 등록하면 바로 쓸 수 있어요.
        {other && ` ${other}`}
      </p>
      <div className="row-btns">
        <Link to="/account#ai-key" className="btn btn-sm btn-primary">
          내 키 등록하기
        </Link>
        <Link to="/help/gemini-key" className="btn btn-sm">
          발급 방법
        </Link>
      </div>
    </div>
  )
}
