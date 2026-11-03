import { useState } from 'react'
import { IconSearch } from '../../components/icons'
import { Pager } from '../../components/Pager'
import { adminApi } from '../../lib/admin'
import { useDebounced, useLoad } from '../../lib/hooks'
import { useLocation } from '../../lib/router'
import { LogTable } from './LogTable'

const GROUPS: [string, string][] = [
  ['', '모든 행동'],
  ['account', '가입·로그인·계정'],
  ['design', '과목 설계'],
  ['curriculum', '편제표'],
  ['ai', '문장으로 찾기·Gemini 키'],
]

/**
 * 사용자 로그: 사용자가 한 일을 시간 순서로 (가입·로그인, 설계에서 바꾼 것 하나하나, 편제표 찾기·읽기, AI 기능).
 * 사용자 탭의 '기록'에서 오면 그 사람 이메일로 찾아 둔다. 사람을 누르면 그 사람 기록만 본다
 */
export function ActivityTab() {
  const { query: url } = useLocation()
  const [q, setQ] = useState(() => url.get('q') ?? '')
  const [group, setGroup] = useState('')
  const [offset, setOffset] = useState(0)
  const query = useDebounced(q.trim(), 250)
  const list = useLoad(() => adminApi.log({ offset, kind: 'user', group, q: query }), `${offset}|${group}|${query}`)

  const setFilter = (fn: () => void) => {
    fn()
    setOffset(0)
  }

  return (
    <div className="admin-log">
      <div className="admin-toolbar">
        <div className="search">
          <IconSearch className="search-icon" />
          <input
            type="search"
            value={q}
            onChange={(e) => setFilter(() => setQ(e.target.value))}
            placeholder="이름·이메일·학교·과목 찾기"
            aria-label="사용자 로그 찾기"
          />
        </div>
        <select className="select" value={group} onChange={(e) => setFilter(() => setGroup(e.target.value))} aria-label="행동 종류">
          {GROUPS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <button type="button" className="btn" onClick={() => list.reload()} disabled={list.loading}>
          새로고침
        </button>
      </div>
      <p className="hint">
        사용자가 한 일을 최근 것부터 보여 줘요. 이름이나 이메일을 누르면 그 사람 기록만 봐요. 1년 동안 남기고, 탈퇴하거나 지운 계정은 누구였는지 알 수 없게
        바꿔요. 올린 파일·적은 문장의 내용과 IP는 남기지 않아요.
      </p>
      {list.error && <p className="form-error">{list.error}</p>}
      <div className={`table-wrap${list.loading ? ' is-loading' : ''}`}>
        {list.data && <LogTable items={list.data.items} onWho={(email) => setFilter(() => setQ(email))} />}
        {list.data && !list.data.items.length && <p className="empty-table">{query || group ? '조건에 맞는 기록이 없어요.' : '아직 기록이 없어요.'}</p>}
        {!list.data && !list.error && <p className="empty-table">불러오는 중</p>}
      </div>
      {list.data && <Pager total={list.data.total} offset={offset} page={list.data.page} onChange={setOffset} />}
    </div>
  )
}
