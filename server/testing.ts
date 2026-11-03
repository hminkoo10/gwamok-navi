// 테스트에서 쓰는 도우미. 앱 코드에서는 쓰지 않는다.
import { Accounts, type Role } from './accounts'
import { type ApiOptions, createApi } from './handler'
import type { ApiContext } from './services'
import { Store } from './store'

type ApiHandler = (req: Request, ctx: ApiContext) => Promise<Response>

/** Google 로그인 없이 계정·세션을 바로 만들어 요청 쿠키(이름=값)를 돌려준다 (인증이 주제가 아닌 테스트용) */
export function sessionFor(store: Store, who: { email: string; role?: Role; sub?: string }): string {
  const accounts = new Accounts(store.db)
  const sub = who.sub ?? `sub-${who.email}`
  const user = accounts.bySub(sub) ?? accounts.create({ sub, email: who.email }, { role: who.role ?? 'user' })
  return `gwamok_sid=${accounts.createSession(user.id).token}`
}

/** 로그인한 사람으로 부르는 API: cookie가 없는 요청에 그 사람의 세션 쿠키를 붙인다 (로그인이 주제가 아닌 테스트용) */
export function signedIn(api: ApiHandler, store: Store, who: { email: string; role?: Role } = { email: 'student@example.com' }): ApiHandler {
  const cookie = sessionFor(store, who)
  return (req, ctx) => {
    if (req.headers.has('cookie')) return api(req, ctx)
    const headers = new Headers(req.headers)
    headers.set('cookie', cookie)
    return api(new Request(req, { headers }), ctx)
  }
}

/** 테스트용 API: 저장소가 없으면 메모리 저장소를 만들고, 로그인한 학생으로 부른다 */
export function testApi(options: ApiOptions = {}): ApiHandler {
  const store = options.store ?? new Store(':memory:')
  return signedIn(createApi({ ...options, store }), store)
}

/** 서명 자리는 비운 ID 토큰 (서버는 Google과 직접 주고받은 토큰의 내용만 검사한다) */
export function fakeIdToken(claims: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${part({ alg: 'RS256', typ: 'JWT' })}.${part(claims)}.c2ln`
}

/** 압축 없이(stored) 담는 최소 zip */
export function makeZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8')
    const nameBuf = Buffer.from(name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBuf, data)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

/** 칸 배열로 HWPX 본문(section0.xml)을 만든다. 첫 줄 위에 제목 문단을 둔다 */
export function hwpxSection(caption: string, rows: string[][]): string {
  const t = (s: string) => `<hp:p><hp:run><hp:t>${s}</hp:t></hp:run></hp:p>`
  const cells = rows
    .map(
      (row, r) =>
        `<hp:tr>${row
          .map(
            (text, c) => `<hp:tc><hp:subList>${t(text)}</hp:subList><hp:cellAddr colAddr="${c}" rowAddr="${r}"/><hp:cellSpan colSpan="1" rowSpan="1"/></hp:tc>`,
          )
          .join('')}</hp:tr>`,
    )
    .join('')
  return `<?xml version="1.0"?><hs:sec xmlns:hs="s" xmlns:hp="p">${t(caption)}<hp:p><hp:run><hp:tbl rowCnt="${rows.length}" colCnt="${rows[0].length}">${cells}</hp:tbl></hp:run></hp:p></hs:sec>`
}
