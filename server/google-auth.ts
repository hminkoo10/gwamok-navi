import { createHash, randomBytes } from 'node:crypto'

// Google 계정으로 로그인 (OpenID Connect 인가 코드 흐름 + PKCE).
// 문서: https://developers.google.com/identity/openid-connect/openid-connect
// ID 토큰은 우리 서버가 Google 토큰 주소와 직접 HTTPS로 주고받아 받는다. 문서대로 이때는 서명 대신 TLS로 출처를 믿고,
// 내용(aud·iss·exp·nonce·이메일 확인 여부)을 검사한다.

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com'])

export interface GoogleConfig {
  clientId: string
  clientSecret: string
  /** Google 클라우드 콘솔의 'OAuth 클라이언트'에 똑같이 등록해 둬야 하는 주소 */
  redirectUri: string
}

export type Env = Record<string, string | undefined>

/** GOOGLE_CLIENT_ID·GOOGLE_CLIENT_SECRET이 있어야 로그인을 켠다 */
export const googleReady = (env: Env) => !!(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim())

/** origin: 요청이 들어온 주소. PUBLIC_URL(예: https://example.com)을 적어 두면 그것을 쓴다 */
export function googleConfig(env: Env, origin: string): GoogleConfig | null {
  if (!googleReady(env)) return null
  const base = (env.PUBLIC_URL?.trim() || origin).replace(/\/+$/, '')
  return { clientId: env.GOOGLE_CLIENT_ID!.trim(), clientSecret: env.GOOGLE_CLIENT_SECRET!.trim(), redirectUri: `${base}/api/auth/google/callback` }
}

/** 대표 관리자 이메일 (OWNER_EMAIL). 이 Google 계정은 늘 대표 관리자이고, 관리자를 지정·취소할 수 있는 유일한 계정이다 */
export const ownerEmail = (env: Env) => (env.OWNER_EMAIL ?? '').trim().toLowerCase()

export const isOwnerEmail = (env: Env, email: string) => !!email && ownerEmail(env) === email.toLowerCase()

const b64url = (buf: Buffer) => buf.toString('base64url')

/** PKCE: verifier는 서버에 두고 challenge만 Google에 보낸다 */
export function pkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32))
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) }
}

export const newNonce = () => b64url(randomBytes(16))

export function authUrl(cfg: GoogleConfig, p: { state: string; nonce: string; challenge: string }): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    // 고유 번호(sub)와 이메일만 받는다 (이름·사진은 받지 않는다)
    scope: 'openid email',
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })
  return `${GOOGLE_AUTH_URL}?${q}`
}

/** 로그인 실패 원인 (서버 기록용. 개인정보는 담지 않는다) */
export class GoogleAuthError extends Error {}

export interface GoogleIdentity {
  /** Google 계정 고유 번호 (이메일이 바뀌어도 그대로) */
  sub: string
  /** Google이 확인한 이메일 (소문자) */
  email: string
}

/** 인가 코드를 ID 토큰으로 바꾸고 검사한다 */
export async function exchangeCode(
  cfg: GoogleConfig,
  code: string,
  verifier: string,
  nonce: string,
  fetchImpl: typeof fetch,
  now = Date.now(),
): Promise<GoogleIdentity> {
  if (!/^[\w./~+-]{10,2000}$/.test(code)) throw new GoogleAuthError('bad code')
  let res: Response
  try {
    res = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new GoogleAuthError('token request failed')
  }
  const data = (await res.json().catch(() => null)) as { id_token?: unknown; error?: unknown } | null
  if (!res.ok || !data || typeof data.id_token !== 'string') {
    const kind = typeof data?.error === 'string' && /^[\w.-]{1,40}$/.test(data.error) ? ` ${data.error}` : ''
    throw new GoogleAuthError(`token HTTP ${res.status}${kind}`)
  }
  return checkIdToken(data.id_token, cfg.clientId, nonce, now)
}

/** ID 토큰 내용 검사: 우리 앱에 준 것(aud), Google이 낸 것(iss), 시간, 이번 로그인(nonce), 확인된 이메일 */
export function checkIdToken(idToken: string, clientId: string, nonce: string, now = Date.now()): GoogleIdentity {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new GoogleAuthError('id token shape')
  let claims: Record<string, unknown>
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    throw new GoogleAuthError('id token json')
  }
  if (!claims || typeof claims !== 'object') throw new GoogleAuthError('id token json')
  const aud = claims.aud
  if (!(aud === clientId || (Array.isArray(aud) && aud.includes(clientId) && claims.azp === clientId))) throw new GoogleAuthError('aud')
  if (typeof claims.iss !== 'string' || !ISSUERS.has(claims.iss)) throw new GoogleAuthError('iss')
  // 시계가 조금 어긋나도 1분까지는 봐준다
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now - 60_000) throw new GoogleAuthError('expired')
  if (typeof claims.iat === 'number' && claims.iat * 1000 > now + 5 * 60_000) throw new GoogleAuthError('iat')
  if (typeof claims.nonce !== 'string' || claims.nonce !== nonce) throw new GoogleAuthError('nonce')
  const sub = claims.sub
  if (typeof sub !== 'string' || !/^[\w-]{1,255}$/.test(sub)) throw new GoogleAuthError('sub')
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : ''
  const verified = claims.email_verified === true || claims.email_verified === 'true'
  if (!email || !verified || email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)) throw new GoogleAuthError('email')
  return { sub, email }
}
