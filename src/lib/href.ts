// 서버·학교 홈페이지에서 가져온 주소로 링크를 만들 때: http·https 주소만 링크로 쓴다 (javascript: 같은 주소는 링크로 만들지 않는다).

/** 링크로 써도 되는 주소면 정리한 주소, 아니면 undefined (그때는 글자만 보인다) */
export function safeHref(url: string | null | undefined): string | undefined {
  if (typeof url !== 'string') return undefined
  const s = url.trim()
  if (!/^https?:\/\//i.test(s)) return undefined
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined
  } catch {
    return undefined
  }
}
