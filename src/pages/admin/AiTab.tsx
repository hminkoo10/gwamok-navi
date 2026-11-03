import { type FormEvent, useState } from 'react'
import { FormError } from '../../components/Form'
import { type AiKind, type AiProvider, type AiProviderDraft, type AiState, type AiTestResult, adminApi } from '../../lib/admin'
import { ApiError } from '../../lib/api'
import { useApp } from '../../lib/app'
import { dateTime } from '../../lib/format'
import { useLoad } from '../../lib/hooks'

const KIND_LABEL: Record<AiKind, string> = { anthropic: 'Claude', google: 'Gemini', openai: 'OpenAI 호환' }

/** 종류마다: 고르는 이름, 공식 주소(비우면 이 주소), 처음 모델, 추론 강도 값, 키 모양 */
const KINDS: Record<AiKind, { label: string; url: string; model: string; textEffort: string; efforts: string[] | null; keyHint: string }> = {
  anthropic: {
    label: 'Claude (Anthropic API)',
    url: 'https://api.anthropic.com',
    model: 'claude-opus-5-5',
    textEffort: 'low',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    keyHint: 'sk-ant-…',
  },
  google: {
    label: 'Gemini (Google AI Studio)',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    // 가장 새 모델(gemini-3.8-flash)은 무료 등급에서 '요청 몰림'(503)이 잦아 한 단계 앞 모델을 처음 값으로 둔다 (2026-10-22 확인)
    model: 'gemini-3.6-flash',
    textEffort: 'low',
    efforts: ['minimal', 'low', 'medium', 'high'],
    keyHint: 'AIza…',
  },
  openai: { label: 'OpenAI 호환 주소', url: '', model: '', textEffort: '', efforts: null, keyHint: '' },
}

/** 고를 수 있게 보여 주는 모델 (Gemini는 2026-10 기준 무료 등급이 있는 모델) */
const MODELS: Partial<Record<AiKind, string[]>> = {
  anthropic: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'],
  google: ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
}

const EMPTY: AiProviderDraft = {
  kind: 'anthropic',
  name: '',
  baseUrl: '',
  model: KINDS.anthropic.model,
  visionModel: '',
  apiKey: '',
  maxTokensParam: 'max_tokens',
  jsonMode: false,
  textEffort: KINDS.anthropic.textEffort,
  visionEffort: '',
}

/** 서버가 저장할 주소 (비우면 공식 주소. Claude는 끝의 /v1을, 나머지는 /chat/completions를 뗀다) */
const savedUrl = (kind: AiKind, url: string) => {
  const u = url.trim().replace(/\/+$/, '')
  return (kind === 'anthropic' ? u.replace(/\/v1$/, '') : u.replace(/\/chat\/completions$/, '')) || KINDS[kind].url
}

const draftOf = (p: AiProvider): AiProviderDraft => ({
  kind: p.kind,
  name: p.name,
  baseUrl: p.kind !== 'openai' && p.baseUrl === KINDS[p.kind].url ? '' : p.baseUrl,
  model: p.model,
  visionModel: p.visionModel,
  apiKey: '',
  maxTokensParam: p.maxTokensParam,
  jsonMode: p.jsonMode,
  textEffort: p.textEffort,
  visionEffort: p.visionEffort,
})

function EffortInput({ kind, value, onChange, label }: { kind: AiKind; value: string; onChange: (v: string) => void; label: string }) {
  const efforts = KINDS[kind].efforts
  return (
    <label className="fieldset">
      <span>{label}</span>
      {efforts ? (
        <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">모델 기본값</option>
          {efforts.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      ) : (
        <input className="input" value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder="비우면 보내지 않아요 (예: low)" maxLength={10} />
      )}
    </label>
  )
}

function ProviderForm({
  initial,
  editing,
  onDone,
  onCancel,
}: {
  initial: AiProviderDraft
  editing: AiProvider | null
  onDone: (s: AiState) => void
  onCancel: () => void
}) {
  const [d, setD] = useState<AiProviderDraft>(initial)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<AiProviderDraft>) => setD({ ...d, ...patch })
  const kind = KINDS[d.kind]
  const models = MODELS[d.kind]
  // 저장된 키는 원래 주소로만 보낸다. 주소·종류를 바꾸면 키를 다시 받는다
  const moved = !!editing && (d.kind !== editing.kind || savedUrl(d.kind, d.baseUrl) !== editing.baseUrl)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!d.name.trim()) return setError('이름을 적어 주세요.')
    if (!d.model.trim()) return setError('모델 이름을 적어 주세요.')
    if (!editing && !d.apiKey.trim()) return setError('API 키를 넣어 주세요.')
    if (moved && !d.apiKey.trim()) return setError('주소나 종류를 바꾸면 키를 다시 넣어 주세요.')
    if (!kind.url && !d.baseUrl.trim()) return setError('주소를 적어 주세요.')
    setBusy(true)
    setError('')
    try {
      onDone(editing ? await adminApi.updateAi(editing.id, d) : await adminApi.createAi(d))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '저장하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="ai-form" onSubmit={(e) => void submit(e)} noValidate>
      <fieldset className="ai-kind">
        <legend className="field-label">종류</legend>
        {(['anthropic', 'google', 'openai'] as const).map((k) => (
          <label key={k} className="check">
            <input
              type="radio"
              name="ai-kind"
              checked={d.kind === k}
              onChange={() => set({ kind: k, model: KINDS[k].model, textEffort: KINDS[k].textEffort, visionEffort: '' })}
            />
            <span>{KINDS[k].label}</span>
          </label>
        ))}
      </fieldset>
      <div className="ai-fields">
        <label className="fieldset">
          <span>이름</span>
          <input
            className="input"
            value={d.name}
            onChange={(e) => set({ name: e.target.value })}
            maxLength={40}
            placeholder={`예: 임시 ${d.kind === 'openai' ? '연결' : KIND_LABEL[d.kind]}`}
          />
        </label>
        <label className="fieldset">
          <span>주소{kind.url ? ' (비우면 공식 주소)' : ''}</span>
          <input
            className="input"
            value={d.baseUrl}
            onChange={(e) => set({ baseUrl: e.target.value.trim() })}
            placeholder={kind.url || 'https://…/v1'}
            inputMode="url"
            spellCheck={false}
          />
        </label>
        <label className="fieldset">
          <span>모델</span>
          <input
            className="input"
            value={d.model}
            onChange={(e) => set({ model: e.target.value.trim() })}
            list={models ? 'ai-models' : undefined}
            spellCheck={false}
          />
        </label>
        <label className="fieldset">
          <span>이미지 읽기 모델 (비우면 위 모델)</span>
          <input
            className="input"
            value={d.visionModel}
            onChange={(e) => set({ visionModel: e.target.value.trim() })}
            list={models ? 'ai-models' : undefined}
            spellCheck={false}
          />
        </label>
        <label className="fieldset is-wide">
          <span>API 키{moved ? ' (주소나 종류를 바꿔서 다시 넣어야 해요)' : editing ? ` (비우면 지금 키 ${editing.keyHint} 그대로)` : ''}</span>
          <input
            className="input"
            type="password"
            value={d.apiKey}
            onChange={(e) => set({ apiKey: e.target.value.trim() })}
            autoComplete="new-password"
            spellCheck={false}
            placeholder={kind.keyHint}
          />
        </label>
        <EffortInput kind={d.kind} label="추론 강도: 문장 찾기" value={d.textEffort} onChange={(v) => set({ textEffort: v })} />
        <EffortInput kind={d.kind} label="추론 강도: 편제표·자료 읽기" value={d.visionEffort} onChange={(v) => set({ visionEffort: v })} />
        {d.kind === 'openai' && (
          <div className="ai-checks">
            <label className="check">
              <input
                type="checkbox"
                checked={d.maxTokensParam === 'max_completion_tokens'}
                onChange={(e) => set({ maxTokensParam: e.target.checked ? 'max_completion_tokens' : 'max_tokens' })}
              />
              <span>max_completion_tokens로 보내기</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={d.jsonMode} onChange={(e) => set({ jsonMode: e.target.checked })} />
              <span>JSON 모드 (response_format)</span>
            </label>
          </div>
        )}
      </div>
      <datalist id="ai-models">
        {(models ?? []).map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <p className="field-hint">
        키는 서버에만 암호화해 두고, 이 화면에는 끝 4자리만 보여요.
        {d.kind === 'anthropic' && ' Claude 연결은 쓴 만큼 Anthropic 계정에 요금이 나가요.'}
      </p>
      {d.kind === 'google' && (
        <p className="field-hint">
          키는 Google AI Studio의 API 키 메뉴에서 받아요. 무료 등급은 모델마다 분당·하루 요청 수가 정해져 있고(AI Studio에서 확인), 넘으면 그날은 AI 기능이
          멈춰요. 무료 등급에서는 보낸 내용과 답을 Google이 제품 개선에 쓰고 검토자가 읽을 수 있어서, 이 연결을 쓰는 동안에는 개인정보 안내와 입력 칸에 그
          사실을 알려요.
        </p>
      )}
      <FormError message={error} />
      <div className="row-btns">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          취소
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? '저장하는 중' : editing ? '고친 내용 저장' : '연결 추가'}
        </button>
      </div>
    </form>
  )
}

/** 시험 실패 원인(HTTP 상태)으로 고칠 곳을 짚는다. Gemini는 키가 틀려도 400을 준다 */
function fixHint(kind: AiKind, detail = ''): string {
  const status = Number(/^HTTP (\d{3})\b/.exec(detail)?.[1])
  if ([400, 401, 403, 404].includes(status)) return '키, 모델 이름, 주소를 확인해 주세요.'
  if (status === 402) return '공급자 계정에 크레딧이 없어요.'
  if (status === 429) return '요청 한도를 넘었어요. 무료 등급이면 하루 한도일 수 있어요.'
  if (status === 503 || detail === 'timeout')
    return kind === 'google'
      ? '이 모델에 요청이 몰려 있어요(보통 잠깐이에요). 잠시 뒤 다시 하거나 고치기에서 모델을 gemini-3.6-flash로 바꿔 보세요.'
      : '공급자 서버에 요청이 몰려 있어요. 잠시 뒤 다시 하거나 다른 모델로 바꿔 보세요.'
  return ''
}

function TestLine({ result, kind }: { result: AiTestResult | 'busy' | undefined; kind: AiKind }) {
  if (!result) return null
  if (result === 'busy') return <p className="ai-test muted">시험하는 중</p>
  const sec = (result.ms / 1000).toFixed(1)
  const hint = result.ok ? '' : fixHint(kind, result.detail)
  return result.ok ? (
    <p className="ai-test is-ok">
      연결돼요 · {sec}초 · {result.model} 답: {result.reply || '(빈 답)'}
    </p>
  ) : (
    <p className="ai-test is-warn">
      실패 · {result.error}
      {result.detail ? ` (${result.detail})` : ''}
      {hint ? ` ${hint}` : ''}
    </p>
  )
}

export function AiTab() {
  const { notify, features } = useApp()
  const loaded = useLoad(() => adminApi.ai(), 'ai')
  const [state, setState] = useState<AiState | null>(null)
  const [form, setForm] = useState<'new' | number | null>(null)
  const [tests, setTests] = useState<Record<string, AiTestResult | 'busy'>>({})
  const [busy, setBusy] = useState(false)

  const s = state ?? loaded.data
  if (loaded.error && !s) return <p className="form-error">{loaded.error}</p>
  if (!s) return <p className="progress-line muted">불러오는 중</p>

  const act = async (fn: () => Promise<AiState>, done: string) => {
    setBusy(true)
    try {
      setState(await fn())
      notify(done)
    } catch (err) {
      notify(err instanceof ApiError ? err.message : '처리하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }
  const test = async (key: string, id: number | null) => {
    setTests((t) => ({ ...t, [key]: 'busy' }))
    try {
      const r = await adminApi.testAi(id)
      setTests((t) => ({ ...t, [key]: r }))
    } catch (err) {
      setTests((t) => ({ ...t, [key]: { ok: false, ms: 0, model: '', error: err instanceof ApiError ? err.message : '시험하지 못했어요.' } }))
    }
  }
  const editing = typeof form === 'number' ? (s.providers.find((p) => p.id === form) ?? null) : null

  return (
    <div className="admin-ai">
      <section className="panel-card">
        <h2 className="card-title">지금 쓰는 AI</h2>
        {s.broken ? (
          <p className="callout is-warn">고른 연결의 키를 풀 수 없어 AI가 꺼져 있어요. 그 연결의 키를 다시 넣거나 다른 연결을 골라 주세요.</p>
        ) : s.using ? (
          <p className="ai-using">
            <strong>{s.using.name}</strong>
            <span className="muted">
              {' '}
              · {KIND_LABEL[s.using.kind]} · {s.using.model}
            </span>
          </p>
        ) : (
          <p className="callout is-warn">쓸 수 있는 AI 연결이 없어요. 아래에서 연결을 추가하고 '이걸로 쓰기'를 눌러 주세요.</p>
        )}
        {features.userKey ? (
          <p className="callout">
            설정의 '사용자 키로 AI 쓰기'가 켜져 있어요. 편제표 자동 읽기, 올린 파일 읽기, 문장으로 분야 찾기는 각 사용자가 등록한 Gemini API 키로 하고, 여기서
            고른 연결은 대입 자료 자동 갱신과 연결 시험에만 쓰여요.
          </p>
        ) : (
          <p className="field-hint">고른 연결은 편제표 자동 읽기, 올린 파일 읽기, 문장으로 분야 찾기, 대입 자료 자동 갱신에 바로 쓰여요.</p>
        )}
      </section>

      <div className="admin-toolbar">
        <button type="button" className="btn btn-primary" onClick={() => setForm(form === 'new' ? null : 'new')} aria-expanded={form === 'new'}>
          연결 추가
        </button>
      </div>

      {form !== null && (
        <section className="panel-card">
          <h2 className="card-title">{editing ? `${editing.name} 고치기` : '연결 추가'}</h2>
          <ProviderForm
            key={String(form)}
            initial={editing ? draftOf(editing) : EMPTY}
            editing={editing}
            onCancel={() => setForm(null)}
            onDone={(next) => {
              setState(next)
              setForm(null)
              notify(editing ? '연결을 고쳤어요.' : '연결을 추가했어요. 시험해 본 뒤 이걸로 쓰기를 눌러 주세요.')
            }}
          />
        </section>
      )}

      <ul className="ai-list">
        <li className={`ai-row${s.active === null && s.env ? ' is-on' : ''}`}>
          <div className="ai-row-main">
            <div>
              <strong>환경변수 설정 (.env)</strong>
              {s.active === null && s.env && <span className="badge is-ok">쓰는 중</span>}
            </div>
            <p className="muted">{s.env ? `OpenAI 호환 · ${s.env.host} · ${s.env.model}` : '서버 환경변수에 AI 설정이 없어요.'}</p>
            <TestLine result={tests.env} kind="openai" />
          </div>
          <div className="row-btns">
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy || s.active === null || !s.env}
              onClick={() => void act(() => adminApi.selectAi(null), '환경변수 설정으로 바꿨어요.')}
            >
              이걸로 쓰기
            </button>
            <button type="button" className="btn btn-sm" disabled={!s.env || tests.env === 'busy'} onClick={() => void test('env', null)}>
              시험
            </button>
          </div>
        </li>
        {s.providers.map((p) => (
          <li key={p.id} className={`ai-row${p.active ? ' is-on' : ''}`}>
            <div className="ai-row-main">
              <div>
                <strong>{p.name}</strong>
                {p.active && <span className={`badge ${p.keyOk ? 'is-ok' : 'is-warn'}`}>{p.keyOk ? '쓰는 중' : '키를 풀 수 없음'}</span>}
                {!p.active && !p.keyOk && <span className="badge is-warn">키를 다시 넣어 주세요</span>}
              </div>
              <p className="muted">
                {KIND_LABEL[p.kind]} · {p.model}
                {p.visionModel && p.visionModel !== p.model ? ` (이미지 ${p.visionModel})` : ''} · 키 {p.keyHint}
                {p.baseUrl !== KINDS[p.kind].url ? ` · ${p.baseUrl}` : ''}
                {p.textEffort || p.visionEffort ? ` · 강도 ${p.textEffort || '기본'}/${p.visionEffort || '기본'}` : ''}
              </p>
              <p className="fine">추가 {dateTime(p.createdAt)}</p>
              <TestLine result={tests[`p${p.id}`]} kind={p.kind} />
            </div>
            <div className="row-btns">
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy || p.active || !p.keyOk}
                onClick={() => void act(() => adminApi.selectAi(p.id), `${p.name} 연결로 바꿨어요.`)}
              >
                이걸로 쓰기
              </button>
              <button type="button" className="btn btn-sm" disabled={!p.keyOk || tests[`p${p.id}`] === 'busy'} onClick={() => void test(`p${p.id}`, p.id)}>
                시험
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setForm(p.id)}>
                고치기
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger-quiet"
                disabled={busy}
                onClick={() => {
                  if (!confirm(`${p.name} 연결을 지울까요?${p.active ? ' 지금 쓰는 연결이라 환경변수 설정으로 돌아가요.' : ''}`)) return
                  void act(() => adminApi.deleteAi(p.id), '연결을 지웠어요.')
                }}
              >
                지우기
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
