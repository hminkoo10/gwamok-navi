import { useState } from 'react'
import { IconSearch } from '../../components/icons'
import { Link } from '../../components/Link'
import { Pager } from '../../components/Pager'
import { type AdminUser, adminApi } from '../../lib/admin'
import { ApiError, ROLE_TEXT } from '../../lib/api'
import { useApp } from '../../lib/app'
import { dateTime } from '../../lib/format'
import { useDebounced, useLoad } from '../../lib/hooks'

export function UsersTab() {
  const { user: me, notify } = useApp()
  const [q, setQ] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')
  const [offset, setOffset] = useState(0)
  const [busyId, setBusyId] = useState<number | null>(null)
  const query = useDebounced(q.trim(), 250)
  const list = useLoad(() => adminApi.users({ q: query, role, status, offset }), `${query}|${role}|${status}|${offset}`)
  const owner = me?.role === 'owner'

  const run = async (u: AdminUser, fn: () => Promise<unknown>, done: string) => {
    setBusyId(u.id)
    try {
      await fn()
      notify(done)
      list.reload()
    } catch (err) {
      notify(err instanceof ApiError ? err.message : '처리하지 못했어요.')
    } finally {
      setBusyId(null)
    }
  }

  const setFilter = (fn: () => void) => {
    fn()
    setOffset(0)
  }

  return (
    <div className="admin-users">
      <div className="admin-toolbar">
        <div className="search">
          <IconSearch className="search-icon" />
          <input
            type="search"
            value={q}
            onChange={(e) => setFilter(() => setQ(e.target.value))}
            placeholder="이름·이메일 찾기"
            aria-label="이름이나 이메일 찾기"
          />
        </div>
        <select className="select" value={role} onChange={(e) => setFilter(() => setRole(e.target.value))} aria-label="권한">
          <option value="">모든 권한</option>
          <option value="admin">관리자</option>
          <option value="user">일반</option>
        </select>
        <select className="select" value={status} onChange={(e) => setFilter(() => setStatus(e.target.value))} aria-label="상태">
          <option value="">모든 상태</option>
          <option value="active">이용 중</option>
          <option value="disabled">정지</option>
        </select>
      </div>
      <p className="field-hint">
        {owner
          ? '관리자로 지정한 사람은 관리 화면을 쓸 수 있지만, 다른 사람을 관리자로 지정하거나 관리자 계정을 정지·삭제할 수는 없어요.'
          : '관리자 지정·취소와 관리자 계정 정지·삭제는 대표 관리자만 할 수 있어요.'}{' '}
        사용자는 Google 계정으로 로그인해 스스로 가입해요.
      </p>

      {list.error && <p className="form-error">{list.error}</p>}
      <div className={`table-wrap${list.loading ? ' is-loading' : ''}`}>
        <table className="table">
          <thead>
            <tr>
              <th>이름</th>
              <th>이메일</th>
              <th>권한</th>
              <th>상태</th>
              <th>가입</th>
              <th>마지막 로그인</th>
              <th>설계 저장</th>
              <th>
                <span className="sr-only">관리</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.data?.items.map((u) => {
              const self = u.id === me?.id
              const busy = busyId === u.id
              // 대표 관리자·내 계정은 못 바꿈. 관리자 계정은 대표 관리자만 바꿈
              const manageable = !self && u.role !== 'owner' && (u.role === 'user' || owner)
              return (
                <tr key={u.id} className={u.disabled ? 'is-dim' : ''}>
                  <td data-label="이름">{u.name ? <strong>{u.name}</strong> : <span className="muted">-</span>}</td>
                  <td data-label="이메일">
                    <span className="user-email">{u.email}</span>
                    {self && <span className="pill">나</span>}
                  </td>
                  <td data-label="권한">
                    {u.role === 'owner' ? (
                      <span className="badge is-ok">{ROLE_TEXT.owner}</span>
                    ) : u.role === 'admin' ? (
                      <span className="badge">{ROLE_TEXT.admin}</span>
                    ) : (
                      '일반'
                    )}
                  </td>
                  <td data-label="상태">{u.disabled ? <span className="badge is-warn">정지</span> : <span className="badge is-ok">이용 중</span>}</td>
                  <td data-label="가입" className="num">
                    {dateTime(u.createdAt, false)}
                  </td>
                  <td data-label="마지막 로그인" className="num">
                    {dateTime(u.lastLoginAt)}
                  </td>
                  <td data-label="설계 저장">{u.saved ? '있음' : '-'}</td>
                  <td className="row-actions">
                    <Link to={`/admin?tab=activity&q=${encodeURIComponent(u.email)}`} className="btn btn-sm">
                      기록
                    </Link>
                    {owner && manageable && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busy}
                        onClick={() => {
                          const grant = u.role === 'user'
                          if (
                            !confirm(
                              grant
                                ? `${u.email}을(를) 관리자로 지정할까요? 관리 화면(설정·편제표·대입 자료·AI 연결·사용자 정지)을 쓸 수 있게 돼요.`
                                : `${u.email}의 관리자 지정을 취소할까요?`,
                            )
                          )
                            return
                          void run(u, () => adminApi.setRole(u.id, grant ? 'admin' : 'user'), grant ? '관리자로 지정했어요.' : '관리자 지정을 취소했어요.')
                        }}
                      >
                        {u.role === 'user' ? '관리자 지정' : '관리자 취소'}
                      </button>
                    )}
                    {manageable && (
                      <>
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={busy}
                          onClick={() => {
                            if (!u.disabled && !confirm(`${u.email}의 이용을 정지할까요? 바로 로그아웃되고 다시 로그인할 수 없어요.`)) return
                            void run(u, () => adminApi.setDisabled(u.id, !u.disabled), u.disabled ? '정지를 풀었어요.' : '이용을 정지했어요.')
                          }}
                        >
                          {u.disabled ? '정지 풀기' : '정지'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger-quiet"
                          disabled={busy}
                          onClick={() => {
                            if (!confirm(`${u.email} 계정을 지울까요? 계정에 저장한 설계도 함께 지워지고 되돌릴 수 없어요.`)) return
                            void run(u, () => adminApi.deleteUser(u.id), '계정을 지웠어요.')
                          }}
                        >
                          지우기
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {list.data && !list.data.items.length && <p className="empty-table">조건에 맞는 사용자가 없어요.</p>}
        {!list.data && !list.error && <p className="empty-table">불러오는 중</p>}
      </div>
      {list.data && <Pager total={list.data.total} offset={offset} page={list.data.page} onChange={setOffset} />}
    </div>
  )
}
