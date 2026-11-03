import type { ChoiceChange, Reopened } from '../engine/choices'
import { josa } from './format'

// 꼭 듣기·빼기를 누른 뒤, 함께 바뀐 것을 알리는 문장

const list = (xs: string[]) => xs.join(', ')
const eul = (word: string) => `${word}${josa(word, '을', '를')}`

const reopenedText = (o: Reopened) =>
  o.set
    ? `${o.where}에서는 세트 하나를 꼭 들어야 해서 ${o.set}(${list(o.subjects)})${josa(o.set, '을', '를')} 다시 넣었어요.`
    : `${o.where}에서는 ${o.pick}과목을 골라야 해서 ${eul(list(o.subjects))} 다시 넣었어요.`

/** 누른 과목에 따라 함께 바뀐 것 (없으면 null). 하지 않은 바꾸기면 그 까닭 */
export function choiceNotice(subject: string, r: ChoiceChange): string | null {
  if (r.refused) {
    const { reason, where } = r.refused
    if (reason === 'every-set') return `${subject}: ${where}의 모든 세트에 들어 있는 과목이라 뺄 수 없어요.`
    if (reason === 'whole-group') return `${subject}: ${where}에서 꼭 들어야 하는 과목이라 뺄 수 없어요.`
    return `${subject}: 들어갈 칸이 없어 꼭 듣기로 할 수 없어요. 학교 편제표를 확인해 주세요.`
  }
  const set = r.set ? `같은 세트(${r.set})` : '같은 세트'
  const parts = [
    r.alsoExcluded.length ? `${set}인 ${list(r.alsoExcluded)}도 함께 뺐어요.` : '',
    r.alsoIncluded.length ? `${set}인 ${list(r.alsoIncluded)}도 함께 다시 넣었어요.` : '',
    ...r.reopened.map(reopenedText),
    r.unpinned.length ? `세트는 하나만 고를 수 있어 ${list(r.unpinned)}의 꼭 듣기를 풀었어요.` : '',
    r.bumped.length ? `들어갈 칸이 모자라 ${list(r.bumped)}의 꼭 듣기를 풀었어요.` : '',
  ].filter(Boolean)
  return parts.length ? `${subject}: ${parts.join(' ')}` : null
}

/** 예전에 저장한 선택을 고친 뒤의 알림 (겹친 것만 정리했으면 null) */
export function repairNotice(r: ChoiceChange): string | null {
  const parts = [
    ...r.reopened.map(reopenedText),
    r.alsoIncluded.length ? `꼭 듣기 과목과 같은 세트인 ${list(r.alsoIncluded)}도 다시 넣었어요.` : '',
    r.bumped.length ? `함께 들을 수 없는 ${list(r.bumped)}의 꼭 듣기를 풀었어요.` : '',
    r.alsoExcluded.length ? `같은 세트 과목을 빼서 들을 수 없는 ${list(r.alsoExcluded)}도 뺐어요.` : '',
  ].filter(Boolean)
  return parts.length ? `저장된 선택 가운데 함께 고를 수 없는 것이 있어 고쳤어요. ${parts.join(' ')}` : null
}
