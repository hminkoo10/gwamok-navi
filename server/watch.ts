import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { isConnectFailure, relayUrl } from './relay'

// 원문 감시: 전형계획·모집요강 같은 공식 자료 주소를 주기적으로 확인해 바뀌면 관리자에게 알린다.
// 파일은 HEAD로 크기·수정 시각·ETag만 보고, 그런 값이 없는 곳(웹 페이지)은 앞부분만 받아 해시를 비교한다.
// 주소는 우리가 정한 목록과 관리자가 넣은 것뿐이다 (사용자가 보낸 주소는 받지 않는다).

export interface WatchSource {
  key: string
  univ: string
  title: string
  url: string
  /** 관리자가 넣은 주소 (지울 수 있다) */
  custom?: boolean
}

export interface WatchRow extends WatchSource {
  status: string
  checkedAt: string | null
  changedAt: string | null
  /** 바뀌었는데 관리자가 아직 확인하지 않음 */
  pending: boolean
  detail: string
}

interface Row {
  key: string
  univ: string
  title: string
  url: string
  custom: number
  etag: string
  last_modified: string
  length: string
  hash: string
  status: string
  checked_at: string | null
  changed_at: string | null
  pending: number
  detail: string
}

const toRow = (r: Row): WatchRow => ({
  key: r.key,
  univ: r.univ,
  title: r.title,
  url: r.url,
  custom: r.custom === 1,
  status: r.status,
  checkedAt: r.checked_at,
  changedAt: r.changed_at,
  pending: r.pending === 1,
  detail: r.detail,
})

export class SourceWatch {
  private db: DatabaseSync
  private fetchImpl: typeof fetch
  private running: Promise<{ checked: number; changed: number }> | null = null
  /** 원문이 바뀐 것을 알게 됐을 때 (대입 자료 자동 갱신이 이어받는다) */
  onChange: ((source: WatchSource) => void) | null = null

  constructor(db: DatabaseSync, fixed: WatchSource[], fetchImpl: typeof fetch = fetch) {
    this.db = db
    this.fetchImpl = fetchImpl
    db.exec(`
      create table if not exists source_watch (
        key text primary key,
        univ text not null default '',
        title text not null,
        url text not null,
        custom integer not null default 0,
        etag text not null default '',
        last_modified text not null default '',
        length text not null default '',
        hash text not null default '',
        status text not null default '확인 전',
        checked_at text,
        changed_at text,
        pending integer not null default 0,
        detail text not null default ''
      );
    `)
    // 정해 둔 원문 목록을 넣거나 주소를 맞춘다 (관리자가 넣은 것은 그대로)
    for (const s of fixed) this.ensure(s)
  }

  /** 정해 둔 원문을 넣거나 주소를 맞춘다 (가져오기로 새로 넣은 대학의 원문도 여기로 더한다) */
  ensure(s: WatchSource): void {
    this.db
      .prepare(
        'insert into source_watch (key, univ, title, url, custom) values (?, ?, ?, ?, 0) on conflict(key) do update set univ = excluded.univ, title = excluded.title, url = excluded.url',
      )
      .run(s.key, s.univ, s.title, s.url)
  }

  list(): WatchRow[] {
    return (this.db.prepare('select * from source_watch order by pending desc, univ, key').all() as unknown as Row[]).map(toRow)
  }

  pendingCount(): number {
    return (this.db.prepare('select count(*) n from source_watch where pending = 1').get() as { n: number }).n
  }

  add(s: { url: string; title: string; univ: string }): WatchRow {
    const key = `custom-${createHash('sha256').update(s.url).digest('hex').slice(0, 12)}`
    this.db
      .prepare('insert into source_watch (key, univ, title, url, custom) values (?, ?, ?, ?, 1) on conflict(key) do nothing')
      .run(key, s.univ, s.title, s.url)
    return toRow(this.db.prepare('select * from source_watch where key = ?').get(key) as unknown as Row)
  }

  remove(key: string): boolean {
    return this.db.prepare('delete from source_watch where key = ? and custom = 1').run(key).changes > 0
  }

  acknowledge(key: string): boolean {
    return this.db.prepare('update source_watch set pending = 0 where key = ?').run(key).changes > 0
  }

  /** 한 번에 하나만 돈다 (겹쳐 부르면 같은 결과를 기다린다) */
  checkAll(now = () => new Date()): Promise<{ checked: number; changed: number }> {
    this.running ??= this.run(now).finally(() => {
      this.running = null
    })
    return this.running
  }

  private async run(now: () => Date): Promise<{ checked: number; changed: number }> {
    const rows = this.db.prepare('select * from source_watch').all() as unknown as Row[]
    let changed = 0
    // 한 번에 4곳씩 (원문 사이트에 부담을 주지 않게)
    for (let i = 0; i < rows.length; i += 4) {
      const batch = rows.slice(i, i + 4)
      const results = await Promise.all(batch.map((r) => this.probe(r.url)))
      batch.forEach((r, j) => {
        const p = results[j]
        const at = now().toISOString()
        if (!p.ok) {
          // 연결 실패는 바뀐 것으로 보지 않는다. 없어진 파일(404·410)은 알린다
          const gone = p.status === 404 || p.status === 410
          if (gone && r.status !== '없어짐') changed++
          this.db
            .prepare(
              'update source_watch set status = ?, checked_at = ?, changed_at = case when ? then ? else changed_at end, pending = case when ? then 1 else pending end, detail = ? where key = ?',
            )
            .run(gone ? '없어짐' : '연결 실패', at, gone && r.status !== '없어짐' ? 1 : 0, at, gone && r.status !== '없어짐' ? 1 : 0, p.detail, r.key)
          return
        }
        const first = !r.checked_at || r.status === '확인 전'
        // 같은 방법으로 잰 값끼리만 비교한다 (방법이 바뀌면 이번 값을 새 기준으로 삼는다)
        const sameKind = p.hash ? !!r.hash : !!(r.etag || r.last_modified)
        const diff =
          !first &&
          sameKind &&
          (p.hash
            ? p.hash !== r.hash
            : (p.etag && p.etag !== r.etag) || (p.lastModified && p.lastModified !== r.last_modified) || (p.length && p.length !== r.length))
        if (diff) {
          changed++
          this.onChange?.({ key: r.key, univ: r.univ, title: r.title, url: r.url })
        }
        this.db
          .prepare(
            'update source_watch set etag = ?, last_modified = ?, length = ?, hash = ?, status = ?, checked_at = ?, changed_at = case when ? then ? else changed_at end, pending = case when ? then 1 else pending end, detail = ? where key = ?',
          )
          .run(
            p.etag,
            p.lastModified,
            p.length,
            p.hash,
            diff ? '바뀜' : first ? '확인함' : r.pending ? '바뀜' : '그대로',
            at,
            diff ? 1 : 0,
            at,
            diff ? 1 : 0,
            p.detail,
            r.key,
          )
      })
    }
    return { checked: rows.length, changed }
  }

  private async probe(url: string): Promise<{ ok: boolean; status: number; etag: string; lastModified: string; length: string; hash: string; detail: string }> {
    const empty = { etag: '', lastModified: '', length: '', hash: '' }
    if (!/^https:\/\//.test(url)) return { ok: false, status: 0, ...empty, detail: 'https 주소만 확인해요' }
    try {
      // 파일은 HEAD의 수정 정보로 본다. HEAD를 막는 서버(403·405 등)와 웹 페이지는 내용을 받아 본다
      const head = await this.fetchImpl(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(15_000) }).catch(() => null)
      if (head?.ok && !isHtml(head)) {
        const etag = head.headers.get('etag') ?? ''
        const lastModified = head.headers.get('last-modified') ?? ''
        const length = head.headers.get('content-length') ?? ''
        if (etag || lastModified)
          return { ok: true, status: head.status, etag, lastModified, length, hash: '', detail: `${length ? `${Math.round(Number(length) / 1024)}KB` : ''}` }
      }
      // 앞부분 256KB만 받는다
      const res = await this.fetchImpl(url, { headers: { range: 'bytes=0-262143' }, redirect: 'follow', signal: AbortSignal.timeout(20_000) })
      if (!res.ok) {
        await res.body?.cancel().catch(() => {})
        return { ok: false, status: res.status, ...empty, detail: `HTTP ${res.status}` }
      }
      // Range를 무시하고 파일을 통째로 주는 서버도 있어 앞부분만 읽고 끊는다
      const buf = await readHead(res, 262_144)
      // 게시글 페이지는 조회수·일회용 토큰 때문에 늘 달라진다: 첨부 파일 목록만 비교한다
      const links = isHtml(res) ? attachmentLinks(buf.toString('latin1')) : []
      return {
        ok: true,
        status: res.status,
        ...empty,
        hash: createHash('sha256')
          .update(links.length ? links.join('\n') : buf)
          .digest('hex')
          .slice(0, 16),
        detail: links.length ? `첨부 ${links.length}개 비교` : '내용 비교',
      }
    } catch (e) {
      const detail = !isConnectFailure(e)
        ? e instanceof DOMException && e.name === 'TimeoutError'
          ? '응답이 너무 늦어요'
          : '연결하지 못했어요'
        : relayUrl()
          ? '연결하지 못했어요 (한국 중계로도 안 돼요)'
          : '연결하지 못했어요 (해외 접속을 막는 사이트일 수 있어요)'
      return { ok: false, status: 0, ...empty, detail }
    }
  }
}

/** 본문 앞부분만 읽는다 (넘으면 끊는다) */
async function readHead(res: Response, max: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (size < max) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.length
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return Buffer.concat(chunks).subarray(0, max)
}

const isHtml = (r: Response) => (r.headers.get('content-type') ?? '').includes('text/html')

/** 웹 페이지의 첨부 파일처럼 보이는 링크 (페이지에 적힌 그대로) */
export function fileLinks(html: string): string[] {
  const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1].replace(/&amp;/g, '&'))
  return hrefs.filter((h) => /download|attach|file_?down|\.(pdf|hwpx?|xlsx?|docx?|zip)(\?|$)/i.test(h) && !/^(javascript|mailto):/i.test(h))
}

/** 첨부 파일 링크 목록 (일회용 토큰·시각 값은 빼고, 순서와 상관없이) */
export function attachmentLinks(html: string): string[] {
  const clean = fileLinks(html).map((h) =>
    h
      .replace(/([?&])(nonce|token|_|t|ts|time|timestamp)=[^&#]*/gi, '$1')
      .replace(/[?&]+$/, '')
      .replace(/&&+/g, '&'),
  )
  return [...new Set(clean)].sort()
}
