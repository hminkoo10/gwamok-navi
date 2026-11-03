// 클립보드 복사. 브라우저는 누른 순간(사용자 동작) 안에서만 복사를 허락하므로, 누르기 전에 글을 만들어 두고 바로 부른다.

/** 숨긴 입력란을 골라 복사하는 예전 방법 (클립보드 API를 못 쓰는 브라우저) */
function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.append(ta)
  ta.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    ta.remove()
  }
}

/** 복사했으면 true. 둘 다 막혔으면 false (부르는 쪽에서 직접 복사할 수 있게 글을 보여 준다) */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 아래 방법으로 한 번 더
  }
  return legacyCopy(text)
}

/** 공유 창을 사용자가 닫았을 때 (오류가 아니다) */
export const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'
