import { useState } from 'react'
import { ADMISSION_TYPES, type AdmissionType, SCHOOL_TYPES, type SchoolType, type SpecialCode } from '../data/schema'
import { contextOf, PROFILE_SPECIALS, SIDO, TYPE_LABEL } from '../engine/admissions'
import { useApp } from '../lib/app'

/** 고를 수 있는 고교 유형 (자주 쓰는 순서) */
const TYPE_CHOICES: SchoolType[] = [
  '일반고',
  '자율고',
  '특성화고',
  '마이스터고',
  '직업계열',
  '과학고',
  '외고',
  '국제고',
  '예술고',
  '체육고',
  '영재학교',
  '방송통신고',
  '검정고시',
  '대안학교',
  '해외고',
]

/** 전형 지원 자격을 볼 때 쓰는 '내 조건' */
export function ProfileForm({ compact = false }: { compact?: boolean }) {
  const { store } = useApp()
  const { profile } = store.prefs
  const school = store.school
  const auto = contextOf({ ...profile, schoolType: '', region: '' }, school)
  const toggleSpecial = (code: SpecialCode) =>
    store.setProfile({ special: profile.special.includes(code) ? profile.special.filter((s) => s !== code) : [...profile.special, code] })
  const toggleType = (t: AdmissionType) => store.setProfile({ types: profile.types.includes(t) ? profile.types.filter((x) => x !== t) : [...profile.types, t] })
  // 대부분은 해당하는 자격이 없다: 고른 것이 없으면 목록을 접어 둔다
  const [showSpecials, setShowSpecials] = useState(() => profile.special.length > 0)
  const picked = PROFILE_SPECIALS.filter((s) => profile.special.includes(s.code))

  return (
    <div className={`profile-form${compact ? ' is-compact' : ''}`}>
      <section className="pf-sec">
        <h3 className="field-label">지금 상태</h3>
        <div className="segmented segmented-2" role="radiogroup" aria-label="지금 상태">
          {(
            [
              ['재학생', '고등학교 재학생', '졸업예정자로 지원'],
              ['졸업생', '졸업생', '졸업 후 다시 지원'],
            ] as const
          ).map(([value, label, sub]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={profile.status === value}
              className={profile.status === value ? 'is-on' : ''}
              onClick={() => store.setProfile({ status: value })}
            >
              <strong>{label}</strong>
              <span>{sub}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="pf-sec pf-row">
        <label className="fieldset">
          <span>고교 유형</span>
          <select
            className="input"
            value={profile.schoolType}
            onChange={(e) =>
              store.setProfile({ schoolType: (SCHOOL_TYPES as readonly string[]).includes(e.target.value) ? (e.target.value as SchoolType) : '' })
            }
          >
            <option value="">{auto.schoolType ? `학교 정보대로 (${auto.schoolType})` : '모름 (골라 주세요)'}</option>
            {TYPE_CHOICES.map((t) => (
              <option key={t} value={t}>
                {t === '자율고' ? '자율고 (자율형 사립고)' : t === '일반고' ? '일반고 (자율형 공립고 포함)' : t}
              </option>
            ))}
          </select>
        </label>
        <label className="fieldset">
          <span>고교 소재지</span>
          <select className="input" value={profile.region} onChange={(e) => store.setProfile({ region: e.target.value })}>
            <option value="">{auto.region ? `학교 정보대로 (${auto.region})` : '모름 (골라 주세요)'}</option>
            {SIDO.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="pf-sec">
        <div className="pf-head">
          <h3 className="field-label">
            해당하는 자격 <span className="muted">{picked.length ? `${picked.length}개 골랐어요` : '없으면 넘어가요'}</span>
          </h3>
          <button type="button" className="btn-link" aria-expanded={showSpecials} onClick={() => setShowSpecials(!showSpecials)}>
            {showSpecials ? '접기' : '자격 고르기'}
          </button>
        </div>
        {!showSpecials && (
          <p className="pf-hint">
            {picked.length
              ? picked.map((s) => s.label).join(', ')
              : '농어촌 학생, 기초생활수급자·차상위·한부모 가정, 장애인, 국가보훈 대상자, 체육·예술 특기자처럼 따로 뽑는 전형이 있어요. 해당하면 골라 주세요.'}
          </p>
        )}
        {showSpecials && (
          <ul className="pf-specials">
            {PROFILE_SPECIALS.map((s) => (
              <li key={s.code}>
                <label className="check">
                  <input type="checkbox" checked={profile.special.includes(s.code)} onChange={() => toggleSpecial(s.code)} />
                  <span>
                    <strong>{s.label}</strong>
                    {!compact && <small>{s.help}</small>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <p className="fine">
          고른 자격은 이 기기에만 두고 계정이나 공유 링크로 보내지 않아요 (로그아웃하면 지워요). 원서 후보에 담은 전형은 계정에 저장돼요. 실제 자격은 대학이
          서류로 확인해요.
        </p>
      </section>

      <section className="pf-sec">
        <h3 className="field-label">
          관심 있는 전형 <span className="muted">고르지 않으면 모두 보여요</span>
        </h3>
        <div className="chips">
          {ADMISSION_TYPES.filter((t) => t !== '기타').map((t) => (
            <button
              key={t}
              type="button"
              className={`chip${profile.types.includes(t) ? ' is-on' : ''}`}
              aria-pressed={profile.types.includes(t)}
              onClick={() => toggleType(t)}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
