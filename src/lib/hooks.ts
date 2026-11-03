import { useEffect, useRef, useState } from 'react'
import { ApiError } from './api'

/** 서버에서 받아 오는 값. key가 바뀌거나 reload를 부르면 다시 받는다 */
export function useLoad<T>(load: () => Promise<T>, key: string) {
  const loader = useRef(load)
  useEffect(() => {
    loader.current = load
  })
  const [tick, setTick] = useState(0)
  const [state, setState] = useState<{ data: T | null; error: string; loading: boolean; for: string }>({ data: null, error: '', loading: true, for: '' })
  const want = `${key}#${tick}`

  useEffect(() => {
    let cancelled = false
    loader
      .current()
      .then((data) => {
        if (!cancelled) setState({ data, error: '', loading: false, for: want })
      })
      .catch((e) => {
        if (!cancelled) setState((s) => ({ data: s.data, error: e instanceof ApiError ? e.message : '불러오지 못했어요.', loading: false, for: want }))
      })
    return () => {
      cancelled = true
    }
  }, [want])

  return {
    data: state.data,
    error: state.error,
    /** 지금 조건으로 받는 중 (이전 결과는 그대로 보여 준다) */
    loading: state.for !== want,
    reload: () => setTick((t) => t + 1),
  }
}

/** 입력이 멈춘 뒤의 값 */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
