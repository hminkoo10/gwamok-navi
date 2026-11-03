import { Dialog } from './Dialog'

/** 브라우저가 클립보드 복사를 막았을 때: 줄바꿈을 그대로 둔 채 직접 골라 복사하게 보여 준다 */
export function CopyDialog({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <Dialog
      open
      title="직접 복사하기"
      mid
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          닫기
        </button>
      }
    >
      <p className="hint">브라우저가 자동 복사를 막았어요. 아래 내용을 모두 골라 복사하세요.</p>
      <textarea className="ta" readOnly rows={12} value={text} data-autofocus onFocus={(e) => e.currentTarget.select()} aria-label="복사할 내용" />
    </Dialog>
  )
}
