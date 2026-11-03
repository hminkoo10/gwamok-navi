import { useState } from 'react'
import { useApp } from '../lib/app'
import { josa } from '../lib/format'
import { Dialog } from './Dialog'

/** 초기화: 꼭 듣기·빼기만 지우거나, 지금 슬롯을 학교만 남기고 비운다. 끝나면 잠깐 되돌리기를 띄운다 */
export function ResetDialog({ onClose }: { onClose: () => void }) {
  const { store, notify } = useApp()
  const { prefs, slots } = store
  const name = slots.find((s) => s.id === prefs.slot)?.name ?? '지금 슬롯'
  const subjects = prefs.pinned.length + prefs.excluded.length
  const [what, setWhat] = useState<'subjects' | 'all'>(subjects ? 'subjects' : 'all')
  const mode = subjects ? what : 'all'

  const run = () => {
    const before = store.resetDesign(mode)
    onClose()
    notify(mode === 'all' ? `${name}${josa(name, '을', '를')} 비웠어요.` : '꼭 듣기·빼기를 지웠어요.', {
      label: '되돌리기',
      run: () => store.restoreDesign(before),
    })
  }

  return (
    <Dialog
      open
      title="초기화"
      mid
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-danger" onClick={run}>
            초기화
          </button>
        </>
      }
    >
      <fieldset className="reset-options">
        <legend className="sr-only">무엇을 초기화할지</legend>
        <label className={`reset-option${mode === 'subjects' ? ' is-on' : ''}`}>
          <input type="radio" name="reset-what" checked={mode === 'subjects'} disabled={!subjects} onChange={() => setWhat('subjects')} />
          <span>
            <strong>꼭 듣기·빼기만 지우기</strong>
            <small>
              {subjects
                ? `직접 고른 꼭 듣기 ${prefs.pinned.length}개, 빼기 ${prefs.excluded.length}개를 지우고 추천대로 되돌려요. 분야·대학은 그대로예요.`
                : '직접 고른 꼭 듣기·빼기가 없어요.'}
            </small>
          </span>
        </label>
        <label className={`reset-option${mode === 'all' ? ' is-on' : ''}`}>
          <input type="radio" name="reset-what" checked={mode === 'all'} onChange={() => setWhat('all')} />
          <span>
            <strong>{name} 전체 초기화</strong>
            <small>분야·대학·학과·꼭 듣기/빼기·목표 전형을 모두 비워요. 학교 편제표, 내 조건, 원서 후보, 다른 슬롯은 그대로예요.</small>
          </span>
        </label>
      </fieldset>
    </Dialog>
  )
}
