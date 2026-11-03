/** 목록 쪽 넘기기: 이전 · 1–50 / 120 · 다음 */
export function Pager({ total, offset, page, onChange }: { total: number; offset: number; page: number; onChange: (offset: number) => void }) {
  if (total <= page) return total ? <p className="pager-info muted">모두 {total.toLocaleString('ko-KR')}개</p> : null
  const end = Math.min(offset + page, total)
  return (
    <nav className="pager" aria-label="쪽 넘기기">
      <button type="button" className="btn btn-sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - page))}>
        이전
      </button>
      <span className="num">
        {(offset + 1).toLocaleString('ko-KR')}–{end.toLocaleString('ko-KR')} / {total.toLocaleString('ko-KR')}
      </span>
      <button type="button" className="btn btn-sm" disabled={end >= total} onClick={() => onChange(offset + page)}>
        다음
      </button>
    </nav>
  )
}
