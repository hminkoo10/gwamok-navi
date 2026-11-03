import { useCallback, useEffect, useState } from 'react'
import { type DataUpdate, dataUpdates } from './api'

// 목표 대학의 대입 자료가 바뀌면 알려 준다. 마지막으로 본 소식의 시각은 이 기기에 둔다.
// 번호가 아니라 시각을 두는 까닭: 서버 DB를 새로 만들면 소식 번호가 1부터 다시 시작한다.

const SEEN_KEY = 'gwamok-navi:seen-update-at'

const readSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY) ?? ''
  } catch {
    return ''
  }
}

const writeSeen = (at: string) => {
  try {
    localStorage.setItem(SEEN_KEY, at)
  } catch {
    // 저장 못 해도 지금 화면에서는 숨긴다
  }
}

/** 아직 보지 않은 목표 대학 소식 (목표 대학이 없으면 모든 소식) */
export const unseenOf = (entries: DataUpdate[], seen: string, univs: string[]) =>
  entries.filter((e) => e.createdAt > seen && (!univs.length || univs.includes(e.key)))

/**
 * 이 기기에 '마지막으로 본 때'가 없을 때(처음 쓰는 기기) 둘 값: 지금까지 나온 소식 중 가장 새것.
 * 그래서 몇 달 전 소식이 새 소식처럼 뜨지 않고, 그 뒤에 나온 소식부터 알린다. 소식이 하나도 없으면 '0' (다음 소식부터 새것)
 */
export const firstSeen = (entries: DataUpdate[]) => entries.reduce((m, e) => (e.createdAt > m ? e.createdAt : m), '0')

export function useUnseenUpdates(univs: string[], enabled: boolean) {
  const [entries, setEntries] = useState<DataUpdate[]>([])
  const [seen, setSeen] = useState(readSeen)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = () =>
      dataUpdates(20)
        .then((r) => {
          if (cancelled) return
          setEntries(r.entries)
          if (!readSeen()) {
            const at = firstSeen(r.entries)
            writeSeen(at)
            // 저장소를 못 쓰는 기기에서는 이 화면에서 처음 정한 값을 그대로 쓴다
            setSeen((cur) => cur || at)
          }
        })
        .catch(() => undefined)
    void load()
    const timer = setInterval(load, 30 * 60_000)
    const onVisible = () => document.visibilityState === 'visible' && void load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled])

  const unseen = unseenOf(entries, seen, univs)

  const markSeen = useCallback(() => {
    const top = entries.reduce((m, e) => (e.createdAt > m ? e.createdAt : m), seen)
    setSeen(top)
    writeSeen(top)
  }, [entries, seen])

  return { unseen, markSeen }
}
