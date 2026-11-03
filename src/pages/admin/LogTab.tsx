import { useState } from 'react'
import { IconSearch } from '../../components/icons'
import { Pager } from '../../components/Pager'
import { adminApi } from '../../lib/admin'
import { useDebounced, useLoad } from '../../lib/hooks'
import { LogTable } from './LogTable'

/** 관리 기록: 관리자가 바꾼 것 (사용자가 한 일은 '사용자 로그' 탭) */
export function LogTab() {
  const [q, setQ] = useState('')
  const [offset, setOffset] = useState(0)
  const query = useDebounced(q.trim(), 250)
  const list = useLoad(() => adminApi.log({ offset, kind: 'admin', q: query }), `${offset}|${query}`)

  return (
    <div className="admin-log">
      <div className="admin-toolbar">
        <div className="search">
          <IconSearch className="search-icon" />
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setOffset(0)
            }}
            placeholder="관리자·대상·내용 찾기"
            aria-label="관리 기록 찾기"
          />
        </div>
      </div>
      <p className="hint">관리자가 바꾼 것을 모두 남겨요. 지울 수 없어요. 사용자가 한 일은 '사용자 로그' 탭에서 봐요.</p>
      {list.error && <p className="form-error">{list.error}</p>}
      <div className={`table-wrap${list.loading ? ' is-loading' : ''}`}>
        {list.data && <LogTable items={list.data.items} />}
        {list.data && !list.data.items.length && <p className="empty-table">{query ? '조건에 맞는 기록이 없어요.' : '아직 기록이 없어요.'}</p>}
        {!list.data && !list.error && <p className="empty-table">불러오는 중</p>}
      </div>
      {list.data && <Pager total={list.data.total} offset={offset} page={list.data.page} onChange={setOffset} />}
    </div>
  )
}
