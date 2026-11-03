import type { DatabaseSync } from 'node:sqlite'

// 요청 제한·캐시·본문 읽기. 하루 사용량(DailyUsage) 말고는 메모리로만 동작한다 (서버 한 대 기준).

/** 한국 시간 날짜 (YYYY-MM-DD). 하루 한도는 한국 시간 자정에 새로 센다 */
export const kstDay = (now = new Date()) => new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10)

/** 고정 창 대신 최근 windowMs 안의 요청 수로 자르는 단순한 제한기 */
export class RateLimiter {
  private hits = new Map<string, number[]>()
  private readonly max: number
  private readonly windowMs: number

  constructor(max: number, windowMs: number) {
    this.max = max
    this.windowMs = windowMs
  }

  /** 한도를 다 썼는지 (세지 않음) */
  full(key: string, now = Date.now()): boolean {
    return (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs).length >= this.max
  }

  /** 기록 지우기. 실패만 세다가 성공했을 때 (로그인 실패 횟수처럼) */
  clear(key: string): void {
    this.hits.delete(key)
  }

  take(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs)
    if (recent.length >= this.max) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(now)
    this.hits.set(key, recent)
    if (this.hits.size > 5000) this.sweep(now)
    return true
  }

  private sweep(now: number) {
    for (const [k, list] of this.hits) if (!list.some((t) => now - t < this.windowMs)) this.hits.delete(k)
  }
}

/** 하루 전체 호출 상한. 키가 새어도 하루 비용이 정해진 선을 넘지 않게. 한도는 관리자 설정에서 */
export class DailyBudget {
  private day = ''
  private count = 0

  private roll(now: Date) {
    const day = kstDay(now)
    if (day !== this.day) {
      this.day = day
      this.count = 0
    }
  }

  take(limit: number, now = new Date()): boolean {
    this.roll(now)
    if (this.count >= limit) return false
    this.count++
    return true
  }

  used(now = new Date()): number {
    this.roll(now)
    return this.count
  }
}

export class LruCache<V> {
  private map = new Map<string, { value: V; at: number }>()
  private readonly size: number
  private readonly ttlMs: number

  constructor(size: number, ttlMs: number) {
    this.size = size
    this.ttlMs = ttlMs
  }

  get(key: string, now = Date.now()): V | undefined {
    const hit = this.map.get(key)
    if (!hit) return undefined
    this.map.delete(key)
    if (now - hit.at > this.ttlMs) return undefined
    this.map.set(key, hit)
    return hit.value
  }

  set(key: string, value: V, now = Date.now()): void {
    this.map.delete(key)
    this.map.set(key, { value, at: now })
    while (this.map.size > this.size) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
  }
}

/**
 * 하루 사용량을 저장소에 센다 (서버를 다시 켜도 이어 센다). key마다 따로 센다: 'all:read'는 서버 전체, 'u:12:read'는 한 사람.
 * 일주일 지난 날의 기록은 지운다
 */
export class DailyUsage {
  private db: DatabaseSync
  private prunedDay = ''

  constructor(db: DatabaseSync) {
    this.db = db
    db.exec('create table if not exists daily_usage (key text not null, day text not null, count integer not null default 0, primary key (key, day))')
  }

  used(key: string, now = new Date()): number {
    const r = this.db.prepare('select count from daily_usage where key = ? and day = ?').get(key, kstDay(now)) as { count: number } | undefined
    return r?.count ?? 0
  }

  /** 한도 안이면 하나 세고 true. 확인과 세기를 쿼리 하나로 해서 동시에 들어온 요청도 넘치지 않음 */
  take(key: string, limit: number, now = new Date()): boolean {
    if (!(limit > 0)) return false
    const day = kstDay(now)
    if (day !== this.prunedDay) {
      this.prunedDay = day
      this.db.prepare('delete from daily_usage where day < ?').run(kstDay(new Date(now.getTime() - 7 * 86400_000)))
    }
    const res = this.db
      .prepare('insert into daily_usage (key, day, count) values (?, ?, 1) on conflict(key, day) do update set count = count + 1 where count < ?')
      .run(key, day, limit)
    return Number(res.changes) > 0
  }
}

export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** JSON 본문을 maxBytes까지만 읽는다 */
export async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > maxBytes) throw new HttpError(413, '요청이 너무 커요.')
  if (!req.body) throw new HttpError(400, '본문이 없어요.')
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new HttpError(413, '요청이 너무 커요.')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) {
    bytes.set(c, offset)
    offset += c.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new HttpError(400, 'JSON 형식이 아니에요.')
  }
}
