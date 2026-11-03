import { ApiError, auth, myData, type SavedData } from './api'

// 계정 저장: 고친 설계를 잠깐 모았다가 올리고, 실패하면 간격을 늘려 가며 다시 올린다.
// 계정 판이 마지막으로 맞춘 판(rev)과 다르면 서버가 409와 계정 설계를 돌려주고, 그것과 합쳐 다시 올린다.
// 화면 상태의 모양은 모른다. 합치기·기준 만들기는 store가 넘겨준다.

/** load-error: 계정 설계를 아직 못 받음, error: 못 올려 다시 시도 중, rejected: 서버가 이 내용을 거절 (400·413) */
export type SyncState = 'off' | 'loading' | 'load-error' | 'saving' | 'saved' | 'error' | 'rejected'

export interface SyncInfo {
  owner: number
  state: SyncState
  /** 계정에 마지막으로 저장된 때 (서버 시각) */
  savedAt: string | null
  /** 서버가 저장을 거절한 까닭 */
  message: string
  /** 연속 실패 횟수 */
  failures: number
}

/** 마지막으로 계정과 맞춘 기준. rev: 그때 계정 판(updatedAt, 비어 있었으면 null), hash: 그때 계정 내용의 해시 */
export interface BaseSnap {
  owner: number
  rev: string | null
  hash: string
}

export interface SyncHost<S, B extends BaseSnap> {
  owner: number
  /** 지금 화면 상태 */
  read(): S
  /** 계정 것과 합친 결과로 바꾼다 */
  apply(next: S): void
  /** 계정에 올릴 내용. 내용이 같으면 JSON도 같아야 한다 (해시로 견줌) */
  payload(s: S): unknown
  /** 계정에 rev 판으로 s가 있을 때의 기준. s가 null이면 빈 계정 */
  snapshot(s: S | null, rev: string | null, hash: string): B
  /** 계정 것(raw, 없으면 null)과 이 기기 것을 base에 견줘 합친다. remote: 계정 것만 되살린 상태 */
  merge(raw: unknown, local: S, base: B | null): { state: S; remote: S | null; dropped: string[] }
  loadBase(): B | null
  saveBase(b: B): void
  report(info: SyncInfo): void
  /** 상한을 넘어 합치지 못한 슬롯·편제표 이름 */
  dropped(names: string[]): void
  /** 다른 탭에서 로그아웃·계정 전환. 저장을 멈춘 뒤에 부른다 */
  accountChanged(): void
}

const SAVE_DELAY = 700
/** 다른 탭에서 받은 변경은 그 탭이 먼저 올리게 기다린다 (ms) */
const ADOPT_DELAY = 3000
/** 실패 횟수별 다시 시도 간격 (ms). 429면 30초 이상 */
const BACKOFF = [2000, 5000, 15_000, 30_000, 60_000]
/** 409가 이어질 때 바로 다시 올리는 횟수. 그 뒤로는 BACKOFF 간격 */
const MAX_CONFLICTS = 3

/** 같은 내용인지 견줄 때만 쓰는 짧은 해시 (53비트 + 길이) */
export function hashText(s: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}.${s.length.toString(36)}`
}

const statusOf = (e: unknown) => (e instanceof ApiError ? e.status : 0)

export class AccountSync<S, B extends BaseSnap> {
  private readonly host: SyncHost<S, B>
  private base: B | null
  private loaded = false
  private stopped = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private loading: Promise<void> | null = null
  private saving: Promise<void> | null = null
  private again = false
  private failures = 0
  private conflicts = 0
  /** 서버가 거절한 내용의 해시. 같은 내용은 다시 보내지 않는다 */
  private refused: string | null = null
  private info: SyncInfo

  constructor(host: SyncHost<S, B>) {
    this.host = host
    const base = host.loadBase()
    this.base = base && base.owner === host.owner ? base : null
    this.info = { owner: host.owner, state: 'loading', savedAt: this.base?.rev ?? null, message: '', failures: 0 }
  }

  private readonly onOnline = () => this.kick()
  private readonly onVisible = () => (document.visibilityState === 'visible' ? this.kick() : this.flush())
  private readonly onHide = () => this.flush()

  start(): void {
    window.addEventListener('online', this.onOnline)
    window.addEventListener('pagehide', this.onHide)
    document.addEventListener('visibilitychange', this.onVisible)
    this.report({ state: 'loading' })
    void this.load()
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.timer)
    window.removeEventListener('online', this.onOnline)
    window.removeEventListener('pagehide', this.onHide)
    document.removeEventListener('visibilitychange', this.onVisible)
  }

  /** 화면 상태가 바뀌었을 때. fromOtherTab: 다른 탭이 저장소에 쓴 것을 받아 온 경우 */
  changed(fromOtherTab = false): void {
    if (this.stopped || !this.loaded) return
    // 실패 뒤 다시 시도를 기다리는 중이면 그때 최신 설계를 올린다 (고칠 때마다 서버를 두드리지 않게)
    if (this.failures > 0) return
    this.schedule(fromOtherTab ? ADOPT_DELAY : SAVE_DELAY)
  }

  /** 바로 다시 시도 (온라인 복귀, 탭 복귀, 다시 시도 버튼) */
  kick(): void {
    if (this.stopped) return
    if (!this.loaded) void this.load()
    else void this.save()
  }

  /** 탭을 떠날 때 못 올린 것을 올린다. 작으면 keepalive라 페이지가 닫혀도 끝까지 간다 */
  private flush(): void {
    if (this.stopped || !this.loaded || this.saving) return
    void this.save(true)
  }

  /** 다른 탭이 저장하고 남긴 기준을 받는다 (더 새 판일 때만) */
  adoptBase(b: B | null): void {
    if (this.stopped || !b || b.owner !== this.host.owner || b.rev === null) return
    if (this.base?.rev && this.base.rev >= b.rev) return
    this.base = b
    if (this.loaded && !this.saving && this.hashOf(this.host.read()) === b.hash) {
      this.failures = 0
      this.report({ state: 'saved', savedAt: b.rev, message: '', failures: 0 })
    }
  }

  /** 이 기기 설계가 계정에 마지막으로 맞춘 것과 같은지 */
  isClean(): boolean {
    return !!this.base && this.hashOf(this.host.read()) === this.base.hash
  }

  /** 밀린 저장을 지금 끝낸다 (로그아웃 전). 계정과 같아졌으면 true */
  async finish(): Promise<boolean> {
    // 올리는 사이 또 바뀌었거나 409로 합쳤으면 더 올린다 (최대 3번)
    for (let i = 0; i < 3 && !this.stopped && this.loaded && !this.isClean(); i++) {
      while (this.saving) await this.saving
      clearTimeout(this.timer)
      await this.save()
      if (this.failures || this.info.state === 'rejected') break
    }
    return this.isClean()
  }

  private hashOf(s: S): string {
    return hashText(JSON.stringify(this.host.payload(s)))
  }

  private report(patch: Partial<SyncInfo>): void {
    this.info = { ...this.info, ...patch }
    if (!this.stopped) this.host.report(this.info)
  }

  private setBase(b: B): void {
    this.base = b
    this.host.saveBase(b)
  }

  private schedule(ms: number): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.save(), ms)
  }

  private retryLater(run: () => void, e: unknown): void {
    const step = BACKOFF[Math.min(this.failures, BACKOFF.length) - 1] ?? BACKOFF[0]
    clearTimeout(this.timer)
    this.timer = setTimeout(run, statusOf(e) === 429 ? Math.max(step, 30_000) : step)
  }

  /** 계정 것(saved)을 받아 이 기기 것과 합치고, 기준을 계정 것으로 맞춘다 */
  private accept(saved: SavedData | null): void {
    const local = this.host.read()
    const { state, remote, dropped } = this.host.merge(saved ? saved.data : null, local, this.base)
    if (state !== local) this.host.apply(state)
    this.setBase(this.host.snapshot(remote, saved?.updatedAt ?? null, remote ? this.hashOf(remote) : ''))
    if (dropped.length) this.host.dropped(dropped)
  }

  private load(): Promise<void> {
    this.loading ??= (async () => {
      clearTimeout(this.timer)
      try {
        const { saved } = await myData.get()
        if (this.stopped) return
        this.accept(saved)
        this.loaded = true
        this.failures = 0
        this.report({ state: 'saved', savedAt: this.base?.rev ?? null, message: '', failures: 0 })
        // 합친 결과가 계정 것과 다르면 올린다 (같으면 save가 아무것도 하지 않는다)
        this.schedule(0)
      } catch (e) {
        if (this.stopped) return
        // 세션이 끝났으면 화면이 로그인으로 보낸다 (AUTH_LOST)
        if (statusOf(e) === 401) return this.stop()
        this.failures++
        this.report({ state: 'load-error', failures: this.failures })
        this.retryLater(() => void this.load(), e)
      }
    })().finally(() => {
      this.loading = null
    })
    return this.loading
  }

  private async save(keepalive = false): Promise<void> {
    if (this.stopped || !this.loaded) return
    if (this.saving) {
      this.again = true
      return this.saving
    }
    clearTimeout(this.timer)
    const state = this.host.read()
    const data = this.host.payload(state)
    const hash = hashText(JSON.stringify(data))
    if (hash === this.base?.hash) {
      this.failures = 0
      this.report({ state: 'saved', savedAt: this.base.rev, message: '', failures: 0 })
      return
    }
    if (hash === this.refused) return
    this.report({ state: 'saving' })
    this.saving = (async () => {
      try {
        const r = await myData.put(data, this.base?.rev ?? null, { keepalive })
        if (this.stopped) return
        this.setBase(this.host.snapshot(state, r.updatedAt, hash))
        this.failures = 0
        this.conflicts = 0
        this.refused = null
        this.report({ state: 'saved', savedAt: r.updatedAt, message: '', failures: 0 })
      } catch (e) {
        if (!this.stopped) await this.failed(e, hash)
      }
    })()
    try {
      await this.saving
    } finally {
      this.saving = null
    }
    // 올리는 사이 또 고쳤으면 한 번 더
    if (this.again && !this.stopped) {
      this.again = false
      if (!this.failures) this.schedule(SAVE_DELAY)
    }
  }

  private async failed(e: unknown, hash: string): Promise<void> {
    const status = statusOf(e)
    if (status === 401) return this.stop()
    if (status === 409) {
      // 다른 기기·탭이 먼저 저장했으면 계정 것과 합쳐 다시 올린다
      if (!(await this.sameAccount()) || this.stopped) return
      const body = e instanceof ApiError ? (e.body as { saved?: SavedData | null } | null) : null
      if (body && typeof body === 'object' && 'saved' in body) this.accept(body.saved ?? null)
      else {
        this.loaded = false
        return void this.load()
      }
      this.conflicts++
      if (this.conflicts <= MAX_CONFLICTS) return this.schedule(0)
      this.failures++
      this.report({ state: 'error', failures: this.failures })
      return this.retryLater(() => void this.save(), e)
    }
    if (status === 400 || status === 413) {
      this.refused = hash
      this.report({ state: 'rejected', message: e instanceof ApiError ? e.message : '' })
      return
    }
    this.failures++
    this.report({ state: 'error', failures: this.failures })
    this.retryLater(() => void this.save(), e)
  }

  /** 409 때 확인: 다른 탭의 계정 전환으로 쿠키가 바뀌었으면 그 계정에 합쳐 올리지 않는다 */
  private async sameAccount(): Promise<boolean> {
    let id: number | null
    try {
      id = (await auth.me()).user?.id ?? null
    } catch {
      // 확인하지 못했으면 그대로 합친다 (다음 저장도 같은 판 검사를 거친다)
      return true
    }
    if (id === this.host.owner) return true
    this.stop()
    this.host.accountChanged()
    return false
  }
}
