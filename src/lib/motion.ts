import { flushSync } from 'react-dom'

// 화면이 통째로 바뀌는 일(페이지 이동, 탭, 슬롯, 꼭 듣기·빼기)을 부드럽게 잇는다.
// 지원하는 브라우저는 View Transitions로 예전 화면에서 새 화면으로 스르륵 넘어가고, 아니면 그냥 바로 바꾼다.
// 어떤 움직임인지는 <html data-vt>로 CSS에 알린다. 움직임을 줄이도록 설정한 기기에서는 CSS가 자리 이동 없이 겹쳐 바뀌게만 한다

/** page: 다른 화면으로 이동 (살짝 떠오르며), swap: 같은 화면 안에서 내용만 바뀜 (빠르게 겹쳐 바뀜) */
export type MotionKind = 'page' | 'swap'

type TransitionDoc = Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } }

let latest = 0

/** update는 바로가 아니라 브라우저가 지금 화면을 찍어 둔 다음에 돈다 (그 안에서 바뀐 화면을 바로 그린다) */
export function smoothly(update: () => void, kind: MotionKind = 'swap'): void {
  const doc = document as TransitionDoc
  if (!doc.startViewTransition) {
    update()
    return
  }
  const id = ++latest
  document.documentElement.dataset.vt = kind
  const t = doc.startViewTransition(() => flushSync(update))
  // 빠르게 여러 번 바꾸면 앞선 전환은 건너뛰고 마지막 것만 끝까지 보인다
  void t.finished.finally(() => {
    if (id === latest) delete document.documentElement.dataset.vt
  })
}
