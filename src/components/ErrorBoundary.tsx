import { Component, type ErrorInfo, type ReactNode } from 'react'

/** 화면을 그리다 오류가 나면 흰 화면 대신 새로고침 단추를 보인다 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="wrap gate" role="alert">
        <h1 className="page-title">화면을 보여 주지 못했어요</h1>
        <p className="page-sub">새로고침해 주세요. 고른 설계는 지워지지 않아요.</p>
        <button type="button" className="btn btn-primary btn-lg" onClick={() => location.reload()}>
          새로고침
        </button>
      </main>
    )
  }
}
