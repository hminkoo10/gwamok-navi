import { useSyncExternalStore } from 'react'
import { smoothly } from './motion'

// 주소 기반 화면 이동. 페이지마다 주소가 있어 새로고침·뒤로 가기·링크 공유가 된다.
// (서버는 확장자 없는 주소를 index.html로 돌려준다)

const listeners = new Set<() => void>()
const emit = () => {
  for (const l of listeners) l()
}
if (typeof window !== 'undefined') window.addEventListener('popstate', emit)

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const snapshot = () => location.pathname + location.search

export function navigate(to: string, opts: { replace?: boolean; keepScroll?: boolean } = {}) {
  const at = to.indexOf('#')
  const hash = at < 0 ? '' : to.slice(at + 1)
  const moving = to !== snapshot() + location.hash
  const change = () => {
    if (moving) {
      history[opts.replace ? 'replaceState' : 'pushState'](null, '', to)
      emit()
    }
    // '#자료' 같은 주소면 화면이 바뀐 다음 그 칸으로 내려간다. 맨 위로는 바로 올린다 (부드러운 스크롤이면 새 화면이 늦게 맞춰진다)
    if (hash) requestAnimationFrame(() => document.getElementById(decodeURIComponent(hash))?.scrollIntoView())
    else if (!opts.keepScroll) window.scrollTo({ top: 0, behavior: 'instant' })
  }
  // 누른 링크로 다른 화면에 갈 때만 스르륵 넘어간다 (주소만 고치는 replace는 바로)
  if (moving && !opts.replace) smoothly(change, opts.keepScroll ? 'swap' : 'page')
  else change()
}

/** 지금 주소 (경로 + 쿼리) */
export function useLocation(): { path: string; query: URLSearchParams } {
  const href = useSyncExternalStore(subscribe, snapshot, () => '/')
  const i = href.indexOf('?')
  return { path: i < 0 ? href : href.slice(0, i), query: new URLSearchParams(i < 0 ? '' : href.slice(i)) }
}
