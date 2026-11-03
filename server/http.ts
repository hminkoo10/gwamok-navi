import { SESSION_DAYS } from './accounts'

// 응답·쿠키 도우미

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })

/** HTTPS면 __Host- 접두어를 붙여 다른 하위 도메인이 덮어쓰지 못하게 한다 */
export const cookieName = (base: string, secure: boolean) => (secure ? `__Host-${base}` : base)
export const sessionCookieName = (secure: boolean) => cookieName('gwamok_sid', secure)

/** 잠깐 쓰는 쿠키 (Google 로그인 중간 단계). maxAge 0이면 지운다 */
export function shortCookie(base: string, value: string, secure: boolean, maxAge: number): string {
  return [`${cookieName(base, secure)}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`, ...(secure ? ['Secure'] : [])].join('; ')
}

/** 다른 곳으로 보내는 응답 (쿠키 여러 개를 함께 담을 수 있다) */
export function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store' })
  for (const c of cookies) headers.append('set-cookie', c)
  return new Response(null, { status: 302, headers })
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

export function sessionCookie(token: string, secure: boolean): string {
  return [`${sessionCookieName(secure)}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_DAYS * 86400}`, ...(secure ? ['Secure'] : [])].join(
    '; ',
  )
}

export function clearSessionCookie(secure: boolean): string {
  return [`${sessionCookieName(secure)}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0', ...(secure ? ['Secure'] : [])].join('; ')
}

/** 주소 쿼리의 숫자 (없거나 이상하면 fallback) */
export function intParam(url: URL, name: string, fallback: number, max = 100_000): number {
  const n = Number(url.searchParams.get(name))
  return Number.isInteger(n) && n >= 0 && n <= max ? n : fallback
}

/** 검색어: 앞뒤 빈칸을 빼고 40자까지 */
export const queryParam = (url: URL, name = 'q') => (url.searchParams.get(name) ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
