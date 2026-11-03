import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// 학교별 교육과정 공유 저장소. 학교 공시·홈페이지 문서를 서버가 직접 받아 읽은 결과와,
// 사람이 원문과 맞춰 본 검증본(method = 'manual')만 저장한다. 같은 학교면 검증본을 먼저 준다.

export interface StoredCurriculum {
  id: number
  office: string
  code: string
  cohort: number
  /** 학과·계열 (없으면 빈 문자열) */
  track: string
  schoolName: string
  region: string
  data: unknown
  sourceUrl: string
  /** 파일이 붙어 있던 게시글 주소 (사람이 원문을 확인할 곳) */
  pageUrl: string
  sourceTitle: string
  method: string
  model: string
  createdAt: string
  /** 관리자가 원문과 맞춰 보고 확인한 것 */
  verified?: boolean
  hidden?: boolean
  /** 이 편제표를 읽게 한 계정 번호 (0이면 모름·사람이 넣음). 관리자가 누가 공유했는지 볼 때 */
  readBy?: number
}

/** 관리 화면 목록에 쓰는 요약 (편제표 본문은 빼고) */
export interface CurriculumSummary {
  id: number
  office: string
  code: string
  cohort: number
  track: string
  schoolName: string
  region: string
  sourceTitle: string
  pageUrl: string
  method: string
  createdAt: string
  verified: boolean
  hidden: boolean
  reports: number
  openReports: number
}

export interface ReportEntry {
  id: number
  curriculumId: number
  schoolName: string
  cohort: number
  track: string
  reason: string
  createdAt: string
  resolved: boolean
}

interface Row {
  id: number
  office: string
  code: string
  cohort: number
  track: string
  school_name: string
  region: string
  data: string
  source_url: string
  page_url: string
  source_title: string
  method: string
  model: string
  created_at: string
  verified: number
  hidden: number
  read_by: number | null
}

const toStored = (r: Row): StoredCurriculum => ({
  id: r.id,
  office: r.office,
  code: r.code,
  cohort: r.cohort,
  track: r.track,
  schoolName: r.school_name,
  region: r.region,
  data: JSON.parse(r.data),
  sourceUrl: r.source_url,
  pageUrl: r.page_url,
  sourceTitle: r.source_title,
  method: r.method,
  model: r.model,
  createdAt: r.created_at,
  verified: r.verified === 1,
  hidden: r.hidden === 1,
  readBy: r.read_by ?? 0,
})

export class Store {
  /** 계정·설정도 같은 파일을 쓴다 */
  readonly db: DatabaseSync

  /** DB 파일 경로 (':memory:'면 메모리) */
  readonly path: string

  constructor(path: string) {
    this.path = path
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`
      pragma journal_mode = wal;
      create table if not exists curricula (
        id integer primary key,
        office text not null,
        code text not null,
        cohort integer not null,
        school_name text not null,
        region text not null default '',
        data text not null,
        source_url text not null default '',
        page_url text not null default '',
        source_title text not null default '',
        method text not null,
        model text not null default '',
        created_at text not null,
        hidden integer not null default 0
      );
      create table if not exists reports (
        id integer primary key,
        curriculum_id integer not null,
        reason text not null,
        created_at text not null
      );
    `)
    // 예전 파일에 없던 칸을 더한다
    const cols = (this.db.prepare('pragma table_info(curricula)').all() as { name: string }[]).map((c) => c.name)
    if (!cols.includes('page_url')) this.db.exec("alter table curricula add column page_url text not null default ''")
    if (!cols.includes('track')) this.db.exec("alter table curricula add column track text not null default ''")
    if (!cols.includes('verified')) this.db.exec('alter table curricula add column verified integer not null default 0')
    if (!cols.includes('read_by')) this.db.exec('alter table curricula add column read_by integer not null default 0')
    const reportCols = (this.db.prepare('pragma table_info(reports)').all() as { name: string }[]).map((c) => c.name)
    if (!reportCols.includes('resolved')) this.db.exec('alter table reports add column resolved integer not null default 0')
    this.db.exec('create index if not exists curricula_key on curricula (office, code, cohort, track, hidden)')
  }

  /** 검증본이 있으면 그것, 없으면 가장 최근에 읽은 것 */
  latest(office: string, code: string, cohort: number, track = ''): StoredCurriculum | null {
    const row = this.db
      .prepare(
        "select * from curricula where office = ? and code = ? and cohort = ? and track = ? and hidden = 0 order by (method = 'manual' or verified = 1) desc, created_at desc, id desc limit 1",
      )
      .get(office, code, cohort, track) as Row | undefined
    return row ? toStored(row) : null
  }

  /** 같은 원문 주소로 읽은 결과가 있으면 다시 읽지 않는다 */
  bySource(office: string, code: string, cohort: number, track: string, sourceUrl: string): StoredCurriculum | null {
    const row = this.db
      .prepare('select * from curricula where office = ? and code = ? and cohort = ? and track = ? and source_url = ? and hidden = 0 order by id desc limit 1')
      .get(office, code, cohort, track, sourceUrl) as Row | undefined
    return row ? toStored(row) : null
  }

  /** 관리자가 숨긴 같은 원문이 있는지 (숨긴 파일을 다시 읽어 공유하지 않게) */
  hiddenSource(office: string, code: string, cohort: number, track: string, sourceUrl: string): boolean {
    return !!this.db
      .prepare('select 1 from curricula where office = ? and code = ? and cohort = ? and track = ? and source_url = ? and hidden = 1 limit 1')
      .get(office, code, cohort, track, sourceUrl)
  }

  insert(c: Omit<StoredCurriculum, 'id' | 'createdAt'>): StoredCurriculum {
    const createdAt = new Date().toISOString()
    const res = this.db
      .prepare(
        'insert into curricula (office, code, cohort, track, school_name, region, data, source_url, page_url, source_title, method, model, created_at, read_by) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        c.office,
        c.code,
        c.cohort,
        c.track,
        c.schoolName,
        c.region,
        JSON.stringify(c.data),
        c.sourceUrl,
        c.pageUrl,
        c.sourceTitle,
        c.method,
        c.model,
        createdAt,
        c.readBy ?? 0,
      )
    return { ...c, id: Number(res.lastInsertRowid), createdAt }
  }

  /** 검증본이 아직 없을 때만 넣는다 (서버를 다시 켜도 한 번만) */
  seed(c: Omit<StoredCurriculum, 'id' | 'createdAt' | 'method' | 'model'>): void {
    const exists = this.db
      .prepare("select 1 from curricula where office = ? and code = ? and cohort = ? and track = ? and method = 'manual' limit 1")
      .get(c.office, c.code, c.cohort, c.track)
    if (!exists) this.insert({ ...c, method: 'manual', model: '' })
  }

  report(curriculumId: number, reason: string): void {
    this.db
      .prepare('insert into reports (curriculum_id, reason, created_at) values (?, ?, ?)')
      .run(curriculumId, reason.slice(0, 300), new Date().toISOString())
  }

  hide(id: number): boolean {
    return this.setHidden(id, true)
  }

  setHidden(id: number, hidden: boolean): boolean {
    return this.db.prepare('update curricula set hidden = ? where id = ?').run(hidden ? 1 : 0, id).changes > 0
  }

  setVerified(id: number, verified: boolean): boolean {
    return this.db.prepare('update curricula set verified = ? where id = ?').run(verified ? 1 : 0, id).changes > 0
  }

  /** 숨긴 것까지 id로 */
  byId(id: number): StoredCurriculum | null {
    const row = this.db.prepare('select * from curricula where id = ?').get(id) as Row | undefined
    return row ? toStored(row) : null
  }

  list(opts: { q?: string; status?: string; offset?: number; limit?: number }): { items: CurriculumSummary[]; total: number } {
    const where: string[] = []
    const args: (string | number)[] = []
    if (opts.q) {
      where.push("(school_name like ? escape '\\' or track like ? escape '\\')")
      const like = `%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
      args.push(like, like)
    }
    if (opts.status === 'hidden') where.push('hidden = 1')
    if (opts.status === 'visible') where.push('hidden = 0')
    if (opts.status === 'verified') where.push("(verified = 1 or method = 'manual')")
    if (opts.status === 'reported') where.push('exists (select 1 from reports r where r.curriculum_id = curricula.id and r.resolved = 0)')
    const cond = where.length ? `where ${where.join(' and ')}` : ''
    const total = (this.db.prepare(`select count(*) n from curricula ${cond}`).get(...args) as { n: number }).n
    const rows = this.db
      .prepare(
        `select id, office, code, cohort, track, school_name, region, source_title, page_url, method, created_at, verified, hidden,
          (select count(*) from reports r where r.curriculum_id = curricula.id) reports,
          (select count(*) from reports r where r.curriculum_id = curricula.id and r.resolved = 0) open_reports
        from curricula ${cond} order by id desc limit ? offset ?`,
      )
      .all(...args, opts.limit ?? 50, opts.offset ?? 0) as (Omit<Row, 'data' | 'source_url' | 'model'> & { reports: number; open_reports: number })[]
    return {
      items: rows.map((r) => ({
        id: r.id,
        office: r.office,
        code: r.code,
        cohort: r.cohort,
        track: r.track,
        schoolName: r.school_name,
        region: r.region,
        sourceTitle: r.source_title,
        pageUrl: r.page_url,
        method: r.method,
        createdAt: r.created_at,
        verified: r.verified === 1 || r.method === 'manual',
        hidden: r.hidden === 1,
        reports: r.reports,
        openReports: r.open_reports,
      })),
      total,
    }
  }

  reports(opts: { status?: string; offset?: number; limit?: number }): { items: ReportEntry[]; total: number } {
    const cond = opts.status === 'all' ? '' : opts.status === 'resolved' ? 'where r.resolved = 1' : 'where r.resolved = 0'
    const total = (this.db.prepare(`select count(*) n from reports r ${cond}`).get() as { n: number }).n
    const rows = this.db
      .prepare(
        `select r.id, r.curriculum_id, r.reason, r.created_at, r.resolved, c.school_name, c.cohort, c.track
        from reports r left join curricula c on c.id = r.curriculum_id ${cond} order by r.id desc limit ? offset ?`,
      )
      .all(opts.limit ?? 50, opts.offset ?? 0) as {
      id: number
      curriculum_id: number
      reason: string
      created_at: string
      resolved: number
      school_name: string | null
      cohort: number | null
      track: string | null
    }[]
    return {
      items: rows.map((r) => ({
        id: r.id,
        curriculumId: r.curriculum_id,
        schoolName: r.school_name ?? '(지워진 편제표)',
        cohort: r.cohort ?? 0,
        track: r.track ?? '',
        reason: r.reason,
        createdAt: r.created_at,
        resolved: r.resolved === 1,
      })),
      total,
    }
  }

  setResolved(id: number, resolved: boolean): boolean {
    return this.db.prepare('update reports set resolved = ? where id = ?').run(resolved ? 1 : 0, id).changes > 0
  }

  stats(): { schools: number; reports: number; total: number; hidden: number; verified: number; openReports: number } {
    const one = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n
    return {
      schools: one("select count(distinct office || code || cohort || '|' || track) n from curricula where hidden = 0"),
      reports: one('select count(*) n from reports'),
      total: one('select count(*) n from curricula'),
      hidden: one('select count(*) n from curricula where hidden = 1'),
      verified: one("select count(*) n from curricula where verified = 1 or method = 'manual'"),
      openReports: one('select count(*) n from reports where resolved = 0'),
    }
  }

  close(): void {
    this.db.close()
  }
}
