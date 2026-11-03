import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { checkPlan } from '../src/data/admissions-check'
import type { AdmissionPlan } from '../src/data/schema'

// 대입 자료를 서버에서 '판'으로 관리한다.
// 기본은 앱과 함께 배포한 자료이고, 관리자가 고친 대학 자료가 그 위를 덮는다. 고칠 때마다 판이 올라가고 소식이 남는다.
// 화면은 판이 바뀐 것을 보고 새 자료를 다시 받는다 (다시 배포하지 않아도 모두에게 바로 보인다).

export interface UpdateEntry {
  id: number
  dataset: string
  key: string
  summary: string
  createdAt: string
}

export interface AdmissionsSnapshot {
  version: string
  updatedAt: string
  year: number
  plans: AdmissionPlan[]
}

export class Datasets {
  private db: DatabaseSync
  private base: { year: number; plans: AdmissionPlan[] }
  private baseHash: string
  private cache: AdmissionsSnapshot | null = null

  constructor(db: DatabaseSync, base: { year: number; plans: AdmissionPlan[] }) {
    this.db = db
    this.base = base
    this.baseHash = createHash('sha256').update(JSON.stringify(base)).digest('hex').slice(0, 10)
    db.exec(`
      create table if not exists data_overrides (
        dataset text not null,
        key text not null,
        data text not null,
        updated_at text not null,
        updated_by text not null default '',
        primary key (dataset, key)
      );
      create table if not exists data_updates (
        id integer primary key,
        dataset text not null,
        key text not null default '',
        summary text not null,
        created_at text not null,
        by text not null default ''
      );
    `)
  }

  private lastUpdate(): { id: number; at: string } {
    const r = this.db.prepare("select id, created_at from data_updates where dataset = 'admissions' order by id desc limit 1").get() as
      { id: number; created_at: string } | undefined
    return r ? { id: r.id, at: r.created_at } : { id: 0, at: '' }
  }

  /** 지금 판: 앱에 든 자료가 바뀌거나(다시 배포) 관리자가 고치면 바뀐다 */
  version(): string {
    return `${this.baseHash}.${this.lastUpdate().id}`
  }

  admissions(): AdmissionsSnapshot {
    const version = this.version()
    if (this.cache?.version === version) return this.cache
    const overrides = new Map(
      (this.db.prepare("select key, data from data_overrides where dataset = 'admissions'").all() as { key: string; data: string }[]).map((r) => [
        r.key,
        JSON.parse(r.data) as AdmissionPlan,
      ]),
    )
    const plans = this.base.plans.map((p) => overrides.get(p.univ) ?? p)
    for (const [univ, p] of overrides) if (!this.base.plans.some((b) => b.univ === univ)) plans.push(p)
    plans.sort((a, b) => a.univ.localeCompare(b.univ))
    const latest = this.lastUpdate()
    this.cache = { version, updatedAt: latest.at, year: this.base.year, plans }
    return this.cache
  }

  plan(univ: string): AdmissionPlan | null {
    return this.admissions().plans.find((p) => p.univ === univ) ?? null
  }

  overrides(): { key: string; updatedAt: string; updatedBy: string }[] {
    return (
      this.db.prepare("select key, updated_at, updated_by from data_overrides where dataset = 'admissions' order by updated_at desc").all() as {
        key: string
        updated_at: string
        updated_by: string
      }[]
    ).map((r) => ({ key: r.key, updatedAt: r.updated_at, updatedBy: r.updated_by }))
  }

  /**
   * 관리자가 고친 대학 자료를 검사해 저장하고 소식을 남긴다 (받은 자료 전체로 덮음).
   * AI 제안은 PlanUpdater.apply가 바꿀 곳만 지금 자료에 옮겨 넘기고, 고친 뒤에는 updater.revalidate로 기다리는 제안을 다시 본다
   */
  setPlan(univ: string, raw: unknown, by: string, summary: string): AdmissionPlan {
    const before = this.plan(univ)
    const plan = checkPlan(raw, univ, before ?? { url: '' })
    const at = new Date().toISOString()
    this.db
      .prepare(
        "insert into data_overrides (dataset, key, data, updated_at, updated_by) values ('admissions', ?, ?, ?, ?) on conflict(dataset, key) do update set data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
      )
      .run(univ, JSON.stringify(plan), at, by)
    this.addUpdate('admissions', univ, summary || diffSummary(before, plan), by)
    return plan
  }

  /** 고친 것을 지우고 배포한 자료로 되돌린다 (관리 화면은 원문 기준·기다리던 제안까지 정리하는 PlanUpdater.revert를 씀) */
  revert(univ: string, by: string): boolean {
    const n = this.db.prepare("delete from data_overrides where dataset = 'admissions' and key = ?").run(univ).changes
    if (n) this.addUpdate('admissions', univ, '배포한 자료로 되돌렸어요', by)
    return n > 0
  }

  addUpdate(dataset: string, key: string, summary: string, by = ''): void {
    this.db
      .prepare('insert into data_updates (dataset, key, summary, created_at, by) values (?, ?, ?, ?, ?)')
      .run(dataset, key, summary.slice(0, 200), new Date().toISOString(), by)
    this.cache = null
  }

  updates(limit = 30): UpdateEntry[] {
    return (
      this.db.prepare('select id, dataset, key, summary, created_at from data_updates order by id desc limit ?').all(limit) as {
        id: number
        dataset: string
        key: string
        summary: string
        created_at: string
      }[]
    ).map((r) => ({ id: r.id, dataset: r.dataset, key: r.key, summary: r.summary, createdAt: r.created_at }))
  }
}

/** 무엇이 바뀌었는지 한 줄로 (전형 수, 모집인원 합) */
export function diffSummary(before: AdmissionPlan | null, after: AdmissionPlan): string {
  const seats = (p: AdmissionPlan) => p.tracks.reduce((n, t) => n + (t.seats ?? 0), 0)
  if (!before) return `전형 ${after.tracks.length}개를 새로 넣었어요`
  const parts: string[] = []
  const added = after.tracks.filter((t) => !before.tracks.some((b) => b.id === t.id)).map((t) => t.name)
  const removed = before.tracks.filter((t) => !after.tracks.some((a) => a.id === t.id)).map((t) => t.name)
  const changed = after.tracks.filter((t) => {
    const b = before.tracks.find((x) => x.id === t.id)
    return b && JSON.stringify(b) !== JSON.stringify(t)
  })
  if (added.length) parts.push(`추가: ${added.slice(0, 3).join(', ')}${added.length > 3 ? ` 외 ${added.length - 3}` : ''}`)
  if (removed.length) parts.push(`삭제: ${removed.slice(0, 3).join(', ')}${removed.length > 3 ? ` 외 ${removed.length - 3}` : ''}`)
  if (changed.length)
    parts.push(
      `변경: ${changed
        .slice(0, 3)
        .map((t) => t.name)
        .join(', ')}${changed.length > 3 ? ` 외 ${changed.length - 3}` : ''}`,
    )
  if (seats(before) !== seats(after)) parts.push(`모집인원 ${seats(before)}→${seats(after)}`)
  return parts.length ? parts.join(' / ') : '세부 내용을 고쳤어요'
}
