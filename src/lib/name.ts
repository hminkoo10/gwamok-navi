// 이름(실명) 규칙. 서버(server/accounts.ts cleanName)와 같은 규칙으로 화면에서 먼저 알려 준다.

/** 빈칸을 정리한 이름 */
export const tidyName = (raw: string) => raw.normalize('NFC').replace(/\s+/g, ' ').trim()

/** 이름이 규칙에 맞지 않으면 그 까닭 (맞으면 빈 문자열): 글자로 시작·끝, 사이에 글자·빈칸·가운뎃점·하이픈·아포스트로피, 2~30자, 자음·모음만은 안 된다 */
export function nameProblem(raw: string): string {
  const name = tidyName(raw)
  if (!name) return '이름을 적어 주세요.'
  if (name.length < 2 || name.length > 30 || !/^\p{L}(?:[\p{L}\p{M} ·'-]*\p{L})?$/u.test(name) || /[ᄀ-ᇿ㄰-㆏]/.test(name))
    return '이름은 실명으로 2~30자, 글자로만 적어 주세요.'
  return ''
}
