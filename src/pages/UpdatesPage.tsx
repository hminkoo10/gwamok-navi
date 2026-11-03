import { Link } from '../components/Link'
import { ScheduleCard } from '../components/ScheduleCard'
import { UNIV_BY_ID } from '../data/universities'
import { useAdmissions } from '../lib/admissions'
import { dataUpdates } from '../lib/api'
import { useApp } from '../lib/app'
import { dateTime } from '../lib/format'
import { useLoad } from '../lib/hooks'
import { safeHref } from '../lib/href'

// 대교협 「2028학년도 대학입학전형시행계획 발표」 보도자료(2026-04-30)의 전국 수치
const NATIONAL = {
  source: 'https://www.kcue.or.kr/_upload/news/2026/04/30/application_3eb96f4ffbc6cf20a16a3396bd07fe8b.pdf',
  total: 348789,
  periods: [
    ['수시', 281895, 80.8],
    ['정시', 66894, 19.2],
  ] as [string, number, number][],
  types: [
    ['학생부교과', 158501, 45.4],
    ['학생부종합', 84806, 24.3],
    ['수능', 61779, 17.7],
    ['실기·실적', 26332, 7.6],
    ['논술', 12727, 3.6],
    ['기타', 4644, 1.3],
  ] as [string, number, number][],
}

export function UpdatesPage() {
  const { features, store } = useApp()
  const data = useAdmissions()
  const feed = useLoad(() => (features.server ? dataUpdates(40).then((r) => r.entries) : Promise.resolve([])), `feed-${features.server}-${data.version}`)
  const name = (key: string) => UNIV_BY_ID.get(key)?.name ?? key

  return (
    <div className="wrap page updates">
      <header className="page-head">
        <p className="eyebrow">2028 대입</p>
        <h1 className="page-title">대입 정보 소식</h1>
        <p className="page-sub">
          대학이 전형을 바꾸거나 자료를 고치면 여기에 남기고, 열려 있는 화면에도 바로 반영해요. 서버가 대학 원문 파일을 주기적으로 확인해요.
        </p>
      </header>

      <ScheduleCard cohort={store.school?.cohort} />

      <section className="panel-card">
        <h2 className="card-title">최근 업데이트</h2>
        {feed.data && feed.data.length > 0 ? (
          <ul className="log-list">
            {feed.data.map((e) => (
              <li key={e.id}>
                <span className="log-time num">{dateTime(e.createdAt)}</span>
                <span>
                  {e.key && UNIV_BY_ID.has(e.key) ? (
                    <Link to={`/universities/${e.key}`}>
                      <strong>{name(e.key)}</strong>
                    </Link>
                  ) : (
                    <strong>{e.key || '전체'}</strong>
                  )}{' '}
                  {e.summary}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{feed.loading ? '불러오는 중' : '아직 바뀐 것이 없어요. 지금 자료는 대학이 2026년 4월 30일에 발표한 시행계획 그대로예요.'}</p>
        )}
      </section>

      <section className="panel-card">
        <h2 className="card-title">2028학년도 전국 모집 현황</h2>
        <p className="card-sub">
          전국 194개 대학 {NATIONAL.total.toLocaleString('ko-KR')}명 ·{' '}
          <a href={NATIONAL.source} target="_blank" rel="noreferrer noopener">
            대교협 발표(2026-04-30)
          </a>
        </p>
        <div className="nat-grid">
          <ul className="usage">
            {NATIONAL.periods.map(([label, n, pct]) => (
              <li key={label}>
                <span>{label}</span>
                <span className="meter" aria-hidden="true">
                  <span style={{ width: `${pct}%` }} />
                </span>
                <span className="num">
                  {n.toLocaleString('ko-KR')}명 ({pct}%)
                </span>
              </li>
            ))}
          </ul>
          <ul className="usage">
            {NATIONAL.types.map(([label, n, pct]) => (
              <li key={label}>
                <span>{label}</span>
                <span className="meter" aria-hidden="true">
                  <span style={{ width: `${pct}%` }} />
                </span>
                <span className="num">
                  {n.toLocaleString('ko-KR')}명 ({pct}%)
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="panel-card">
        <h2 className="card-title">대학별 원문</h2>
        <p className="card-sub">전형 찾기에 쓴 대학별 「2028학년도 대학입학전형시행계획」이에요. 최종 내용은 대학이 내는 모집요강을 확인하세요.</p>
        <ul className="src-docs">
          {[...data.plans]
            .sort((a, b) => name(a.univ).localeCompare(name(b.univ), 'ko'))
            .map((p) => (
              <li key={p.univ}>
                {safeHref(p.page ?? p.url) ? (
                  <a href={safeHref(p.page ?? p.url)} target="_blank" rel="noreferrer noopener">
                    {name(p.univ)}
                  </a>
                ) : (
                  name(p.univ)
                )}
                <span className="muted">
                  {' '}
                  · {p.date} · 전형 {p.tracks.length}개
                </span>
              </li>
            ))}
        </ul>
      </section>
    </div>
  )
}
