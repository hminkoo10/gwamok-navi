import { createHash, randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

// 계정·로그인 세션·계정에 저장한 설계·관리 기록.
// 로그인은 Google 계정으로만 한다: Google 계정 고유 번호(sub)와 이메일만 보관하고 비밀번호는 없다.
// 세션 토큰과 로그인 중간 단계의 값은 SHA-256으로만 저장한다 (저장소가 새어도 바로 쓸 수 없게).

/** owner: 대표 관리자 (OWNER_EMAIL로 정한 한 사람, 관리자 지정·취소를 한다), admin: 지정된 관리자, user: 일반 */
export type Role = 'user' | 'admin' | 'owner'

/** 관리 화면을 쓸 수 있는 권한 */
export const isAdmin = (u: { role: Role }) => u.role === 'admin' || u.role === 'owner'

export interface User {
  id: number
  /** Google 계정 이메일 (관리 화면에서 사람을 알아보는 데 쓴다. 로그인할 때마다 맞춘다) */
  email: string
  /** 가입할 때 적은 실명 (관리자가 사람을 알아보는 데 쓴다. 예전에 가입한 사람은 비어 있을 수 있다) */
  name: string
  role: Role
  disabled: boolean
  createdAt: string
  lastLoginAt: string | null
}

interface UserRow {
  id: number
  google_sub: string
  email: string
  name: string | null
  role: string
  disabled: number
  created_at: string
  last_login_at: string | null
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  name: r.name ?? '',
  role: r.role === 'owner' || r.role === 'admin' ? r.role : 'user',
  disabled: r.disabled === 1,
  createdAt: r.created_at,
  lastLoginAt: r.last_login_at,
})

/**
 * 실명: 빈칸을 정리하고, 글자(한글·영문 등)로 시작하고 끝나며 사이에는 글자·빈칸·가운뎃점·하이픈·아포스트로피만, 2~30자.
 * 숫자·기호나 자음·모음만 쓴 이름(ㅇㅇ)은 받지 않는다. 맞지 않으면 null
 */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim()
  if (name.length < 2 || name.length > 30) return null
  if (!/^\p{L}(?:[\p{L}\p{M} ·'-]*\p{L})?$/u.test(name)) return null
  if (/[\u1100-\u11FF\u3130-\u318F]/.test(name)) return null
  return name
}

export class AccountError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// ---- 세션 ----

export const SESSION_DAYS = 30
const hashOf = (token: string) => createHash('sha256').update(token).digest('hex')
const newToken = () => randomBytes(32).toString('base64url')
const TOKEN_RE = /^[A-Za-z0-9_-]{40,60}$/

/** Google 로그인 중간 단계(로그인 시작 → Google → 돌아옴)의 유효 시간 */
const FLOW_MINUTES = 10
/** 처음 로그인한 사람이 동의하고 가입을 마칠 때까지의 유효 시간 */
const PENDING_MINUTES = 15

export interface SavedData {
  data: unknown
  updatedAt: string
}

/** admin: 관리자가 바꾼 것 (지우지 않는다), user: 사용자가 한 일 (ACTIVITY_DAYS 뒤에 지운다) */
export type LogKind = 'admin' | 'user'

export interface LogEntry {
  id: number
  kind: LogKind
  /** 한 사람의 이메일 (사용자가 탈퇴했거나 지워졌으면 그 사실만) */
  who: string
  /** 그 사람의 지금 이름 (이름이 없거나 탈퇴·삭제했으면 빈 문자열) */
  name: string
  action: string
  target: string
  detail: string
  /** 같은 일을 잠깐 사이에 여러 번 했으면 그 횟수 (한 줄로 모은다) */
  times: number
  createdAt: string
}

/** 사용자가 한 일을 남겨 두는 날수 */
export const ACTIVITY_DAYS = 365
/** 한 사람의 기록을 남겨 두는 줄 수 (넘으면 오래된 것부터 지운다) */
export const ACTIVITY_PER_USER = 5000
/** 탈퇴하거나 지운 계정이 남긴 기록에 쓰는 이름 (누구였는지 알 수 없게) */
export const GONE_USER = '탈퇴·삭제한 계정'

/** 로그인 시작 때 정한 값 (Google에서 돌아왔을 때 맞춰 본다) */
export interface OAuthFlow {
  verifier: string
  nonce: string
  next: string
}

/** Google 로그인은 했지만 아직 가입 동의를 하지 않은 사람 */
export interface PendingSignup {
  sub: string
  email: string
  next: string
}

export class Accounts {
  private db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
    // 아이디·비밀번호 시절의 표는 지우지 않고 이름만 바꿔 둔다. 그 계정의 세션은 끊고, 설계는 새 계정 id와 겹치지 않게 옮긴다
    const legacy = (db.prepare('pragma table_info(users)').all() as { name: string }[]).some((c) => c.name === 'password')
    if (legacy) {
      const tables = new Set((db.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((t) => t.name))
      const keep = (name: string) => (tables.has(name) ? `${name}_${Date.now()}` : name)
      db.exec('begin')
      try {
        db.exec(`alter table users rename to ${keep('users_password_legacy')}`)
        if (tables.has('user_data')) db.exec(`alter table user_data rename to ${keep('user_data_password_legacy')}`)
        if (tables.has('sessions')) db.exec('delete from sessions')
        db.exec('commit')
      } catch (e) {
        db.exec('rollback')
        throw e
      }
      console.log('[auth] 아이디·비밀번호 계정 표를 users_password_legacy로 옮겼어요. 이제 Google 계정으로만 로그인해요.')
    }
    db.exec(`
      create table if not exists users (
        id integer primary key autoincrement,
        google_sub text not null unique,
        email text not null default '',
        name text not null default '',
        role text not null default 'user',
        disabled integer not null default 0,
        created_at text not null,
        last_login_at text
      );
      create table if not exists sessions (
        id text primary key,
        user_id integer not null,
        created_at text not null,
        expires_at text not null,
        last_seen_at text not null
      );
      create index if not exists sessions_user on sessions (user_id);
      create table if not exists user_data (
        user_id integer primary key,
        data text not null,
        updated_at text not null
      );
      create table if not exists admin_log (
        id integer primary key,
        admin_id integer not null,
        admin_name text not null,
        action text not null,
        target text not null default '',
        detail text not null default '',
        created_at text not null,
        kind text not null default 'admin',
        times integer not null default 1
      );
      create table if not exists oauth_flows (
        id text primary key,
        verifier text not null,
        nonce text not null,
        next text not null,
        created_at text not null
      );
      create table if not exists oauth_pending (
        id text primary key,
        google_sub text not null,
        email text not null,
        next text not null,
        created_at text not null
      );
    `)
    // 실명 칸 (예전에 가입한 사람은 비어 있다)
    if (!(db.prepare('pragma table_info(users)').all() as { name: string }[]).some((c) => c.name === 'name'))
      db.exec("alter table users add column name text not null default ''")
    // 관리 기록에 사용자가 한 일도 함께 남긴다 (예전 표에는 kind·times 칸을 더한다)
    const logCols = new Set((db.prepare('pragma table_info(admin_log)').all() as { name: string }[]).map((c) => c.name))
    if (!logCols.has('kind')) db.exec("alter table admin_log add column kind text not null default 'admin'")
    if (!logCols.has('times')) db.exec('alter table admin_log add column times integer not null default 1')
    db.exec('create index if not exists admin_log_at on admin_log (created_at)')
    db.exec('create index if not exists admin_log_who on admin_log (admin_id, action)')
    this.keepIdsUnique()
  }

  /**
   * 지운 계정의 번호를 새 가입자가 물려받지 않게 한다. 예전 표는 autoincrement 없이 만들어 가장 큰 번호를 다시 썼고,
   * 탈퇴와 겹쳐 늦게 들어온 저장이 남긴 설계·키를 다음 가입자가 받을 수 있었다.
   * 표를 autoincrement로 다시 만들고, 주인 없는 설계·키·세션은 지우고, 다음 번호가 기록에 남은 어떤 번호보다 크게 한다
   */
  private keepIdsUnique(): void {
    const db = this.db
    const sql = (db.prepare("select sql from sqlite_master where type = 'table' and name = 'users'").get() as { sql: string } | undefined)?.sql ?? ''
    db.exec('begin')
    try {
      if (!/autoincrement/i.test(sql)) {
        db.exec(`
          create table users_next (
            id integer primary key autoincrement,
            google_sub text not null unique,
            email text not null default '',
            name text not null default '',
            role text not null default 'user',
            disabled integer not null default 0,
            created_at text not null,
            last_login_at text
          );
          insert into users_next (id, google_sub, email, name, role, disabled, created_at, last_login_at)
            select id, google_sub, email, coalesce(name, ''), role, disabled, created_at, last_login_at from users;
          drop table users;
          alter table users_next rename to users;
        `)
      }
      for (const t of ['sessions', 'user_data', ...(this.hasKeys() ? ['user_ai_keys'] : [])])
        db.exec(`delete from ${t} where user_id not in (select id from users)`)
      const max = (q: string) => Number((db.prepare(q).get() as { n: number | null }).n ?? 0)
      const floor = Math.max(max('select max(id) n from users'), max('select max(admin_id) n from admin_log'))
      const seq = db.prepare("select seq from sqlite_sequence where name = 'users'").get() as { seq: number } | undefined
      if (!seq) db.prepare("insert into sqlite_sequence (name, seq) values ('users', ?)").run(floor)
      else if (seq.seq < floor) db.prepare("update sqlite_sequence set seq = ? where name = 'users'").run(floor)
      db.exec('commit')
    } catch (e) {
      db.exec('rollback')
      throw e
    }
  }

  /** 사용자 Gemini 키 표가 있는지 (UserAiKeys가 만든다) */
  private hasKeys(): boolean {
    return !!this.db.prepare("select 1 from sqlite_master where type = 'table' and name = 'user_ai_keys'").get()
  }

  // ---- 사용자 ----

  private row(where: 'id' | 'google_sub', value: string | number): UserRow | undefined {
    return this.db.prepare(`select * from users where ${where} = ?`).get(value) as UserRow | undefined
  }

  byId(id: number): User | null {
    const r = this.row('id', id)
    return r ? toUser(r) : null
  }

  /** Google 계정 고유 번호로 찾는다 */
  bySub(sub: string): User | null {
    const r = this.row('google_sub', sub)
    return r ? toUser(r) : null
  }

  create(identity: { sub: string; email: string }, opts: { role?: Role; name?: string } = {}): User {
    if (this.row('google_sub', identity.sub)) throw new AccountError(409, '이미 가입한 Google 계정이에요.')
    const res = this.db
      .prepare('insert into users (google_sub, email, name, role, created_at) values (?, ?, ?, ?, ?)')
      .run(identity.sub, identity.email, opts.name ?? '', opts.role ?? 'user', new Date().toISOString())
    return this.byId(Number(res.lastInsertRowid))!
  }

  /** 실명을 바꾼다 (cleanName을 거친 값만) */
  setName(id: number, name: string): void {
    this.db.prepare('update users set name = ? where id = ?').run(name, id)
  }

  /** 로그인할 때 Google 계정 이메일이 바뀌었으면 맞춘다 */
  setEmail(id: number, email: string): void {
    this.db.prepare('update users set email = ? where id = ? and email != ?').run(email, id, email)
  }

  setRole(id: number, role: Role): void {
    this.db.prepare('update users set role = ? where id = ?').run(role, id)
  }

  /**
   * 대표 관리자를 OWNER_EMAIL에 맞춘다: 그 이메일 계정은 owner, 예전 owner였던 다른 계정은 지정된 관리자로 둔다.
   * 서버를 켤 때와 로그인할 때 부른다 (이메일 비교는 소문자로)
   */
  syncOwner(email: string): void {
    const owner = email.trim().toLowerCase()
    this.db.prepare("update users set role = 'admin' where role = 'owner' and lower(email) != ?").run(owner)
    if (owner) this.db.prepare("update users set role = 'owner', disabled = 0 where lower(email) = ?").run(owner)
  }

  setDisabled(id: number, disabled: boolean): void {
    this.db.prepare('update users set disabled = ? where id = ?').run(disabled ? 1 : 0, id)
    if (disabled) this.revokeAll(id)
  }

  /** 계정을 지운다: 세션·설계·등록한 Gemini 키까지 한 번에. 그 사람이 한 일의 기록은 남기되 누가 했는지는 지운다 */
  remove(id: number): void {
    this.db.exec('begin')
    try {
      this.db.prepare('delete from sessions where user_id = ?').run(id)
      this.db.prepare('delete from user_data where user_id = ?').run(id)
      if (this.hasKeys()) this.db.prepare('delete from user_ai_keys where user_id = ?').run(id)
      this.db.prepare('delete from users where id = ?').run(id)
      this.db.prepare("update admin_log set admin_id = 0, admin_name = ? where kind = 'user' and admin_id = ?").run(GONE_USER, id)
      this.db.exec('commit')
    } catch (e) {
      this.db.exec('rollback')
      throw e
    }
  }

  list(opts: { q?: string; role?: string; status?: string; offset?: number; limit?: number }): { users: (User & { saved: boolean })[]; total: number } {
    const where: string[] = []
    const args: (string | number)[] = []
    if (opts.q) {
      const like = `%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
      where.push("(email like ? escape '\\' or name like ? escape '\\')")
      args.push(like, like)
    }
    // '관리자'로 거르면 대표 관리자도 함께 보인다
    if (opts.role === 'admin') where.push("role in ('admin', 'owner')")
    if (opts.role === 'user') where.push("role = 'user'")
    if (opts.status === 'disabled') where.push('disabled = 1')
    if (opts.status === 'active') where.push('disabled = 0')
    const cond = where.length ? `where ${where.join(' and ')}` : ''
    const total = (this.db.prepare(`select count(*) n from users ${cond}`).get(...args) as { n: number }).n
    const rows = this.db
      .prepare(`select users.*, (select 1 from user_data d where d.user_id = users.id) saved from users ${cond} order by id desc limit ? offset ?`)
      .all(...args, opts.limit ?? 50, opts.offset ?? 0) as unknown as (UserRow & { saved: number | null })[]
    return { users: rows.map((r) => ({ ...toUser(r), saved: r.saved === 1 })), total }
  }

  stats(now = new Date()): { total: number; admins: number; disabled: number; new7d: number; active7d: number } {
    const week = new Date(now.getTime() - 7 * 86400_000).toISOString()
    const one = (sql: string, ...args: string[]) => (this.db.prepare(sql).get(...args) as { n: number }).n
    return {
      total: one('select count(*) n from users'),
      admins: one("select count(*) n from users where role in ('admin', 'owner')"),
      disabled: one('select count(*) n from users where disabled = 1'),
      new7d: one('select count(*) n from users where created_at >= ?', week),
      active7d: one('select count(*) n from users where last_login_at >= ?', week),
    }
  }

  // ---- Google 로그인 중간 단계 ----

  /** 로그인을 시작한다. 돌려준 state를 Google에 보내고 같은 값을 쿠키에도 둔다 */
  startFlow(flow: OAuthFlow, now = new Date()): string {
    const state = newToken()
    const at = now.toISOString()
    this.db.prepare('delete from oauth_flows where created_at < ?').run(new Date(now.getTime() - FLOW_MINUTES * 60_000).toISOString())
    this.db
      .prepare('insert into oauth_flows (id, verifier, nonce, next, created_at) values (?, ?, ?, ?, ?)')
      .run(hashOf(state), flow.verifier, flow.nonce, flow.next, at)
    return state
  }

  /** Google에서 돌아온 state의 값을 꺼낸다 (한 번만 쓸 수 있고, 시간이 지났으면 null) */
  takeFlow(state: string, now = new Date()): OAuthFlow | null {
    if (!TOKEN_RE.test(state)) return null
    const id = hashOf(state)
    const r = this.db.prepare('select verifier, nonce, next, created_at from oauth_flows where id = ?').get(id) as
      (OAuthFlow & { created_at: string }) | undefined
    if (!r) return null
    this.db.prepare('delete from oauth_flows where id = ?').run(id)
    if (now.getTime() - Date.parse(r.created_at) > FLOW_MINUTES * 60_000) return null
    return { verifier: r.verifier, nonce: r.nonce, next: r.next }
  }

  /** 처음 로그인한 사람: 동의를 받을 때까지 Google 계정을 잠시 맡아 둔다. 돌려준 토큰을 쿠키에 둔다 */
  startPending(p: PendingSignup, now = new Date()): string {
    const token = newToken()
    this.db.prepare('delete from oauth_pending where created_at < ?').run(new Date(now.getTime() - PENDING_MINUTES * 60_000).toISOString())
    this.db
      .prepare('insert into oauth_pending (id, google_sub, email, next, created_at) values (?, ?, ?, ?, ?)')
      .run(hashOf(token), p.sub, p.email, p.next, now.toISOString())
    return token
  }

  /** 맡아 둔 가입 정보. take면 꺼내면서 지운다 */
  pending(token: string, { take = false } = {}, now = new Date()): PendingSignup | null {
    if (!TOKEN_RE.test(token)) return null
    const id = hashOf(token)
    const r = this.db.prepare('select google_sub, email, next, created_at from oauth_pending where id = ?').get(id) as
      { google_sub: string; email: string; next: string; created_at: string } | undefined
    if (!r) return null
    if (take) this.db.prepare('delete from oauth_pending where id = ?').run(id)
    if (now.getTime() - Date.parse(r.created_at) > PENDING_MINUTES * 60_000) return null
    return { sub: r.google_sub, email: r.email, next: r.next }
  }

  // ---- 세션 ----

  createSession(userId: number, now = new Date()): { token: string; expiresAt: string } {
    const token = newToken()
    const at = now.toISOString()
    const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86400_000).toISOString()
    this.db
      .prepare('insert into sessions (id, user_id, created_at, expires_at, last_seen_at) values (?, ?, ?, ?, ?)')
      .run(hashOf(token), userId, at, expiresAt, at)
    this.db.prepare('update users set last_login_at = ? where id = ?').run(at, userId)
    // 오래된 세션 정리
    this.db.prepare('delete from sessions where expires_at < ?').run(at)
    return { token, expiresAt }
  }

  /** 토큰으로 사용자를 찾는다. 만료·정지된 계정이면 null */
  sessionUser(token: string, now = new Date()): User | null {
    if (!TOKEN_RE.test(token)) return null
    const id = hashOf(token)
    const s = this.db.prepare('select user_id, expires_at, last_seen_at from sessions where id = ?').get(id) as
      { user_id: number; expires_at: string; last_seen_at: string } | undefined
    if (!s) return null
    const at = now.toISOString()
    if (s.expires_at < at) {
      this.db.prepare('delete from sessions where id = ?').run(id)
      return null
    }
    const user = this.byId(s.user_id)
    if (!user || user.disabled) return null
    // 마지막 사용 시각은 한 시간에 한 번만 적는다
    if (now.getTime() - Date.parse(s.last_seen_at) > 3600_000) this.db.prepare('update sessions set last_seen_at = ? where id = ?').run(at, id)
    return user
  }

  revokeSession(token: string): void {
    this.db.prepare('delete from sessions where id = ?').run(hashOf(token))
  }

  /** 그 사용자의 모든 세션을 끊는다 */
  revokeAll(userId: number): void {
    this.db.prepare('delete from sessions where user_id = ?').run(userId)
  }

  activeSessions(now = new Date()): number {
    return (this.db.prepare('select count(distinct user_id) n from sessions where expires_at >= ?').get(now.toISOString()) as { n: number }).n
  }

  // ---- 계정에 저장한 설계 ----

  getData(userId: number): SavedData | null {
    const r = this.db.prepare('select data, updated_at from user_data where user_id = ?').get(userId) as { data: string; updated_at: string } | undefined
    return r ? { data: JSON.parse(r.data), updatedAt: r.updated_at } : null
  }

  /** 저장해 둔 설계 원문 (바뀌었는지 견줄 때) */
  dataText(userId: number): string | null {
    const r = this.db.prepare('select data from user_data where user_id = ?').get(userId) as { data: string } | undefined
    return r?.data ?? null
  }

  /**
   * 설계를 저장하고 저장한 시각을 돌려준다. 그사이 계정이 지워졌으면 저장하지 않고 null
   * (탈퇴와 겹쳐 늦게 끝난 저장이 주인 없는 설계를 남기지 않게)
   */
  putData(userId: number, data: string): string | null {
    let at = new Date().toISOString()
    // 같은 밀리초에 두 번 저장해도 저장 시각(설계 판)이 겹치지 않게 한다
    const prev = this.db.prepare('select updated_at from user_data where user_id = ?').get(userId) as { updated_at: string } | undefined
    if (prev && prev.updated_at >= at) at = new Date(Date.parse(prev.updated_at) + 1).toISOString()
    const res = this.db
      .prepare(
        'insert into user_data (user_id, data, updated_at) select ?, ?, ? where exists (select 1 from users where id = ?) on conflict(user_id) do update set data = excluded.data, updated_at = excluded.updated_at',
      )
      .run(userId, data, at, userId)
    return Number(res.changes) > 0 ? at : null
  }

  /** 저장해 둔 설계의 저장 시각 (없으면 null). 화면이 마지막으로 본 판과 같은지 견줄 때 */
  dataVersion(userId: number): string | null {
    const r = this.db.prepare('select updated_at from user_data where user_id = ?').get(userId) as { updated_at: string } | undefined
    return r?.updated_at ?? null
  }

  // ---- 관리 기록 ----

  /** 관리자가 바꾼 것 */
  log(admin: User, action: string, target = '', detail = ''): void {
    this.db
      .prepare("insert into admin_log (admin_id, admin_name, action, target, detail, created_at, kind) values (?, ?, ?, ?, ?, ?, 'admin')")
      .run(admin.id, admin.email, action, target.slice(0, 120), detail.slice(0, 300), new Date().toISOString())
  }

  private prunedAt = 0

  /**
   * 사용자가 한 일. mergeMinutes 안에 같은 사람이 같은 대상에 같은 일을 또 하면 새 줄 대신 그 줄의 내용·시각을 바꾸고 횟수를 올린다
   * (설계는 고칠 때마다 저장하므로 줄이 넘치지 않게). ACTIVITY_DAYS가 지난 사용자 기록은 지운다
   */
  activity(user: { id: number; email: string }, action: string, target = '', detail = '', opts: { mergeMinutes?: number } = {}, now = new Date()): void {
    const at = now.toISOString()
    const t = target.slice(0, 120)
    const d = detail.slice(0, 300)
    if (Math.abs(now.getTime() - this.prunedAt) > 3600_000) {
      this.prunedAt = now.getTime()
      this.db.prepare("delete from admin_log where kind = 'user' and created_at < ?").run(new Date(now.getTime() - ACTIVITY_DAYS * 86400_000).toISOString())
      // 한 사람의 기록은 최근 ACTIVITY_PER_USER줄까지만 둔다 (설계를 아주 자주 바꿔도 표가 끝없이 커지지 않게)
      this.db
        .prepare(
          "delete from admin_log where id in (select id from (select id, row_number() over (partition by admin_id order by id desc) rn from admin_log where kind = 'user' and admin_id != 0) where rn > ?)",
        )
        .run(ACTIVITY_PER_USER)
    }
    if (opts.mergeMinutes) {
      const since = new Date(now.getTime() - opts.mergeMinutes * 60_000).toISOString()
      const prev = this.db
        .prepare(
          "select id, detail from admin_log where kind = 'user' and admin_id = ? and action = ? and target = ? and created_at >= ? order by created_at desc limit 1",
        )
        .get(user.id, action, t, since) as { id: number; detail: string } | undefined
      // 된 일과 실패한 일은 따로 모은다 (실패가 앞서 된 일의 기록을 덮지 않게)
      if (prev && prev.detail.includes('실패:') === d.includes('실패:')) {
        this.db.prepare('update admin_log set detail = ?, created_at = ?, times = times + 1 where id = ?').run(d, at, prev.id)
        return
      }
    }
    // 그사이 탈퇴한 계정이면 남기지 않는다 (지운 계정의 이메일이 기록에 다시 남지 않게)
    this.db
      .prepare(
        "insert into admin_log (admin_id, admin_name, action, target, detail, created_at, kind) select ?, ?, ?, ?, ?, ?, 'user' where exists (select 1 from users where id = ?)",
      )
      .run(user.id, user.email, action, t, d, at, user.id)
  }

  /**
   * 기록 목록 (최근 것부터). kind로 관리자·사용자 기록을, actions로 행동 묶음(앞부분이 같은 행동, 예: 'design.')을 거르고,
   * q로 이름·이메일·대상·내용을 찾는다. 이름은 지금 계정의 이름을 붙인다 (탈퇴·삭제한 계정은 없다)
   */
  logs(opts: { offset?: number; limit?: number; kind?: LogKind | ''; q?: string; actions?: string[] } = {}): { entries: LogEntry[]; total: number } {
    const where: string[] = []
    const args: (string | number)[] = []
    if (opts.kind === 'admin' || opts.kind === 'user') {
      where.push('l.kind = ?')
      args.push(opts.kind)
    }
    if (opts.actions?.length) {
      where.push(`(${opts.actions.map(() => "l.action like ? escape '\\'").join(' or ')})`)
      args.push(...opts.actions.map((a) => (a.endsWith('.') ? `${a.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : a.replace(/[\\%_]/g, (c) => `\\${c}`))))
    }
    if (opts.q) {
      const like = `%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
      where.push("(l.admin_name like ? escape '\\' or l.target like ? escape '\\' or l.detail like ? escape '\\' or coalesce(u.name, '') like ? escape '\\')")
      args.push(like, like, like, like)
    }
    const cond = where.length ? `where ${where.join(' and ')}` : ''
    const from = 'from admin_log l left join users u on u.id = l.admin_id'
    const total = (this.db.prepare(`select count(*) n ${from} ${cond}`).get(...args) as { n: number }).n
    const rows = this.db
      .prepare(`select l.*, coalesce(u.name, '') as user_name ${from} ${cond} order by l.created_at desc, l.id desc limit ? offset ?`)
      .all(...args, opts.limit ?? 50, opts.offset ?? 0) as {
      id: number
      kind: string
      admin_name: string
      user_name: string
      action: string
      target: string
      detail: string
      times: number
      created_at: string
    }[]
    return {
      entries: rows.map((r) => ({
        id: r.id,
        kind: r.kind === 'user' ? 'user' : 'admin',
        who: r.admin_name,
        name: r.user_name,
        action: r.action,
        target: r.target,
        detail: r.detail,
        times: r.times,
        createdAt: r.created_at,
      })),
      total,
    }
  }
}
