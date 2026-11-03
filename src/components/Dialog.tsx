import { type ReactNode, useEffect, useRef } from 'react'
import { IconClose } from './icons'

interface Props {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  /** 목록 고르기 창 크기 */
  mid?: boolean
  /**
   * Esc나 닫기 단추로 닫기 전에 부른다. false를 돌려주면 열어 둔다 (고친 내용이 있을 때 물어보려고).
   * 없으면 바로 닫는다
   */
  confirmClose?: () => boolean
}

/** 브라우저 기본 <dialog>를 쓴다 (포커스 가두기·Esc 닫기를 브라우저가 처리) */
export function Dialog({ open, title, onClose, children, footer, wide, mid, confirmClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const guard = useRef(confirmClose)
  useEffect(() => {
    guard.current = confirmClose
  })
  // 닫기로 정한 뒤에 오는 close 이벤트인지 (그때는 다시 묻지 않는다)
  const closing = useRef(false)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      closing.current = false
      d.showModal()
      // 브라우저는 첫 버튼(닫기)에 포커스를 두므로, 입력란이 있으면 그리로 옮긴다
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    }
    if (!open && d.open) d.close()
  }, [open])

  /** 닫기 단추·Esc: 물어볼 것이 있으면 묻고 닫는다 */
  const requestClose = () => {
    if (guard.current && !guard.current()) return
    closing.current = true
    onClose()
  }

  return (
    <dialog
      ref={ref}
      className={`modal${wide ? ' is-wide' : mid ? ' is-mid' : ''}`}
      onCancel={(e) => {
        if (!guard.current) return
        e.preventDefault()
        requestClose()
      }}
      onClose={() => {
        // Esc를 막지 못하고 브라우저가 닫아 버렸으면(Esc를 잇달아 누른 경우) 다시 열고 묻는다
        if (open && guard.current && !closing.current) {
          if (guard.current()) {
            closing.current = true
            onClose()
          } else ref.current?.showModal()
          return
        }
        onClose()
      }}
      aria-label={title}
    >
      <header className="modal-head">
        <h2>{title}</h2>
        <button type="button" className="btn-icon" onClick={requestClose} aria-label="닫기">
          <IconClose />
        </button>
      </header>
      <div className="modal-body">{open ? children : null}</div>
      {footer && <footer className="modal-foot">{footer}</footer>}
    </dialog>
  )
}
