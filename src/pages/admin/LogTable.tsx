import { ACTION_LABEL, type LogEntry } from '../../lib/admin'
import { dateTime } from '../../lib/format'

/** 관리 기록·사용자 로그 표. onWho를 주면 사람을 눌러 그 사람 기록만 볼 수 있다 */
export function LogTable({ items, onWho }: { items: LogEntry[]; onWho?: (email: string) => void }) {
  return (
    <table className="table log-table">
      <thead>
        <tr>
          <th>시각</th>
          <th>누가</th>
          <th>한 일</th>
          <th>대상</th>
          <th>내용</th>
        </tr>
      </thead>
      <tbody>
        {items.map((e) => {
          const who = (
            <>
              {e.name && <strong className="log-name">{e.name}</strong>}
              <span className={e.name ? 'muted log-email' : 'log-email'}>{e.who}</span>
            </>
          )
          return (
            <tr key={e.id}>
              <td data-label="시각" className="num">
                {dateTime(e.createdAt)}
              </td>
              <td data-label="누가">
                {onWho && e.who.includes('@') ? (
                  <button type="button" className="log-who" onClick={() => onWho(e.who)} title="이 사람 기록만 보기">
                    {who}
                  </button>
                ) : (
                  <span className="log-who">{who}</span>
                )}
                {e.kind === 'admin' && <span className="pill">관리자</span>}
              </td>
              <td data-label="한 일">
                {ACTION_LABEL[e.action] ?? e.action}
                {e.times > 1 && <span className="muted"> {e.times}번</span>}
              </td>
              <td data-label="대상">{e.target || '-'}</td>
              <td data-label="내용">{e.detail || '-'}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
