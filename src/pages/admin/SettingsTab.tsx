import { useState } from 'react'
import { type SettingField, type SettingValues, adminApi } from '../../lib/admin'
import { ApiError } from '../../lib/api'
import { useApp } from '../../lib/app'
import { useLoad } from '../../lib/hooks'

function SettingInput({ field, value, onChange }: { field: SettingField; value: SettingValues[string]; onChange: (v: SettingValues[string]) => void }) {
  const id = `setting-${field.key}`
  if (field.type === 'bool')
    return (
      <div className="setting-row">
        <div className="setting-text">
          <label htmlFor={id} className="setting-label">
            {field.label}
          </label>
          <p className="setting-help">{field.help}</p>
        </div>
        <label className="toggle">
          <input id={id} type="checkbox" role="switch" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          <span className="toggle-track" aria-hidden="true" />
        </label>
      </div>
    )
  if (field.type === 'int')
    return (
      <div className="setting-row">
        <div className="setting-text">
          <label htmlFor={id} className="setting-label">
            {field.label}
          </label>
          <p className="setting-help">
            {field.help} ({field.min?.toLocaleString('ko-KR')}~{field.max?.toLocaleString('ko-KR')})
          </p>
        </div>
        <input
          id={id}
          className="input input-num"
          type="number"
          inputMode="numeric"
          min={field.min}
          max={field.max}
          value={String(value)}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Math.trunc(Number(e.target.value)))}
        />
      </div>
    )
  const text = typeof value === 'string' ? value : ''
  return (
    <div className="setting-row is-wide">
      <div className="setting-text">
        <label htmlFor={id} className="setting-label">
          {field.label}
        </label>
        <p className="setting-help">{field.help}</p>
      </div>
      <div className="setting-input">
        <input
          id={id}
          className="input"
          type="text"
          maxLength={field.max}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          placeholder="예: 10월 25일 밤 10시부터 30분 동안 점검해요."
        />
        <span className="counter num">
          {text.length}/{field.max}
        </span>
      </div>
    </div>
  )
}

export function SettingsTab() {
  const { notify } = useApp()
  const loaded = useLoad(() => adminApi.settings(), 'settings')
  const [draft, setDraft] = useState<SettingValues | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (loaded.error && !loaded.data) return <p className="form-error">{loaded.error}</p>
  if (!loaded.data) return <p className="progress-line muted">불러오는 중</p>
  const { fields, values } = loaded.data
  const current = draft ?? values
  const changed = fields.filter((f) => current[f.key] !== values[f.key])
  const invalid = fields.find(
    (f) =>
      f.type === 'int' && (typeof current[f.key] !== 'number' || (current[f.key] as number) < (f.min ?? 0) || (current[f.key] as number) > (f.max ?? Infinity)),
  )
  const groups = [...new Set(fields.map((f) => f.group))]

  const save = async () => {
    if (invalid) return setError(`${invalid.label}은(는) ${invalid.min}~${invalid.max} 사이로 적어 주세요.`)
    setBusy(true)
    setError('')
    try {
      await adminApi.saveSettings(Object.fromEntries(changed.map((f) => [f.key, current[f.key]])))
      notify('설정을 저장했어요. 바로 적용돼요.')
      setDraft(null)
      loaded.reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '저장하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-settings">
      {groups.map((g) => (
        <section key={g} className="panel-card">
          <h2 className="card-title">{g}</h2>
          <div className="setting-list">
            {fields
              .filter((f) => f.group === g)
              .map((f) => (
                <SettingInput key={f.key} field={f} value={current[f.key]} onChange={(v) => setDraft({ ...current, [f.key]: v })} />
              ))}
          </div>
        </section>
      ))}
      <div className={`save-bar${changed.length ? ' is-on' : ''}`} role="region" aria-label="설정 저장">
        <p>{changed.length ? `바꾼 설정 ${changed.length}개` : '바꾼 설정이 없어요'}</p>
        {error && <p className="field-error">{error}</p>}
        <div className="row-btns">
          <button
            type="button"
            className="btn"
            disabled={!changed.length || busy}
            onClick={() => {
              setDraft(null)
              setError('')
            }}
          >
            되돌리기
          </button>
          <button type="button" className="btn btn-primary" disabled={!changed.length || busy} onClick={() => void save()}>
            {busy ? '저장하는 중' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
