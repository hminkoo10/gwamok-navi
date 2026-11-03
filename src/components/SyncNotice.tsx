import { useApp } from '../lib/app'

/**
 * 계정에 저장하지 못하고 있을 때 설계 화면 위에 띄운다. 고친 내용은 이 기기에 남아 있고 연결되면 다시 저장한다.
 * 한 번 실패는 곧 다시 해 보므로, 두 번 잇달아 실패했을 때부터 보인다 (서버가 거절한 것은 바로)
 */
export function SyncNotice() {
  const { store } = useApp()
  const { sync, syncMessage, syncFailures, retrySync } = store
  if (sync === 'rejected')
    return (
      <div className="callout is-warn no-print" role="status">
        <p>계정에 저장하지 못하고 있어요. {syncMessage || '저장할 내용이 맞지 않아요.'} 고친 내용은 이 기기에만 있어요.</p>
      </div>
    )
  if ((sync !== 'error' && sync !== 'load-error') || syncFailures < 2) return null
  return (
    <div className="callout is-warn no-print" role="status">
      <p>
        {sync === 'load-error'
          ? '계정에 저장한 설계를 불러오지 못하고 있어요. 지금은 이 기기의 설계를 보여 주고, 연결되면 합쳐서 저장해요.'
          : '계정에 저장하지 못하고 있어요. 고친 내용은 이 기기에 남아 있고, 연결되면 다시 저장해요.'}
      </p>
      <div className="row-btns">
        <button type="button" className="btn btn-sm" onClick={retrySync}>
          지금 다시 시도
        </button>
      </div>
    </div>
  )
}
