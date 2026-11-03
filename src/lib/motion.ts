import { flushSync } from 'react-dom'

// 화면이 통째로 바뀌는 일(페이지 이동, 탭, 슬롯, 꼭 듣기·빼기)을 View Transitions로 잇는다. 지원하지 않으면 바로 바꾼다.
// 움직임 종류는 <html data-vt>로 CSS에 알린다. 움직임 줄이기 설정이면 CSS가 자리 이동 없이 겹쳐 바뀌게만 한다

/** page: 다른 화면으로 이동 (살짝 떠오름), swap: 같은 화면 안 내용만 바뀜 (빠르게 겹침) */
export type MotionKind = 'page' | 'swap'

type TransitionDoc = Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } }

let latest = 0

/** update는 바로 돌지 않고 브라우저가 지금 화면을 찍어 둔 뒤에 돈다 (그 안에서 flushSync로 바로 그린다) */
export function smoothly(update: () => void, kind: MotionKind = 'swap'): void {
  const doc = document as TransitionDoc
  if (!doc.startViewTransition) {
    update()
    return
  }
  const id = ++latest
  document.documentElement.dataset.vt = kind
  const t = doc.startViewTransition(() => flushSync(update))
  // 잇달아 바꾸면 앞선 전환은 건너뛰므로 data-vt는 마지막 전환이 끝날 때만 지운다
  void t.finished.finally(() => {
    if (id === latest) delete document.documentElement.dataset.vt
  })
}
