// 클립보드 복사. 브라우저가 사용자 동작 안에서만 복사를 허락하므로, 글은 미리 만들어 두고 누를 때 바로 부른다.

/** 숨긴 textarea를 선택해 복사하는 예전 방법 (클립보드 API를 못 쓰는 브라우저) */
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

/** 복사했으면 true. 두 방법 다 막히면 false (부르는 쪽이 글을 보여 줘 직접 복사하게) */
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

/** 사용자가 공유 창을 닫은 경우 (오류 아님) */
export const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'
