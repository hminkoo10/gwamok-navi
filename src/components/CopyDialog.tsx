import { Dialog } from './Dialog'

/** 클립보드 복사가 막혔을 때 직접 골라 복사하는 창 (줄바꿈 유지) */
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
