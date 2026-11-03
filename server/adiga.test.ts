import { createCipheriv } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { adigaFileUrl } from './adiga'
import { viewTextSection } from './hwp'
import { innerDoc } from './plan-files'
import { makeZip } from './testing'

describe('어디가 시행계획 파일', () => {
  it('대학 상세의 파일 목록에서 시행계획 칸의 받는 주소를 만든다', () => {
    const html = `<ul class="mT40 downloadList body1 med" id="fileResult">
      <li> <a href="#none" onclick="fnUnvFileDownOne(&#39;00000000000000254586&#39;, &#39;1&#39;, &#39;Y&#39;, &#39;0000060&#39; , &#39;2028&#39; )"> <span>대학입학전형<br />시행계획</span> </a> </li>
      <li class="disabled"> <a href="#none"> <span>수시<br />모집요강</span> </a> </li>
    </ul>`
    expect(adigaFileUrl(html, '0000060')).toBe(
      'https://www.adiga.kr/cmm/com/file/fileDown.do?fileId=00000000000000254586&fileSn=1&menuId=PCUVTINF2000&downLogYn=Y&unvCd=0000060&searchSyr=2028',
    )
  })

  it('시행계획 파일을 올리지 않았으면 없다고 한다', () => {
    const html = `<ul id="fileResult"><li class="disabled"><a href="#none"><span>대학입학전형<br />시행계획</span></a></li></ul>`
    expect(adigaFileUrl(html, '0000060')).toBeNull()
    expect(adigaFileUrl('<html></html>', '0000060')).toBeNull()
  })
})

describe('압축 파일로 올린 원문', () => {
  it('안의 문서 중 가장 큰 것(본 시행계획)을 꺼낸다', () => {
    const main = `%PDF-1.7 ${'본문 '.repeat(200)}`
    const zip = makeZip({ '2028 시행계획/': '', '2028 시행계획/외국인 특별전형.pdf': '%PDF-1.7 짧은 문서', '2028 시행계획/본 계획.pdf': main })
    expect(innerDoc(zip).toString('utf8')).toBe(main)
    // HWPX(한글 문서)는 그대로 읽는다
    const hwpx = makeZip({ mimetype: 'application/hwp+zip', 'Contents/section0.xml': '<hs:sec/>' })
    expect(innerDoc(hwpx)).toBe(hwpx)
    // 압축 파일이 아니면 그대로
    const pdf = Buffer.from('%PDF-1.7')
    expect(innerDoc(pdf)).toBe(pdf)
  })
})

describe('배포용 한글 문서', () => {
  it('맨 앞 레코드에서 열쇠를 꺼내 본문을 푼다', () => {
    const seed = 0x1234_5679
    // 풀었을 때의 앞 레코드: (씨앗 & 0xf) + 4 자리에 열쇠
    const plain = Buffer.alloc(256, 0x41)
    plain.writeUInt32LE(seed, 0)
    const key = Buffer.from('0123456789abcdef')
    key.copy(plain, 4 + (seed & 0xf))
    // 같은 난수로 XOR하면 저장된 모양이 된다
    const stored = Buffer.from(plain)
    let state = seed
    const rand = () => {
      state = (Math.imul(state, 214013) + 2531011) >>> 0
      return (state >>> 16) & 0x7fff
    }
    let k = 0
    let n = 0
    for (let i = 0; i < 256; i++) {
      if (n === 0) {
        k = rand() & 0xff
        n = (rand() & 0xf) + 1
      }
      if (i >= 4) stored[i] ^= k
      n--
    }
    const body = Buffer.from('본문 레코드가 들어 있는 자리입니다 0123456789'.padEnd(48, '.'))
    const cipher = createCipheriv('aes-128-ecb', key, null)
    cipher.setAutoPadding(false)
    const padded = Buffer.concat([body, Buffer.alloc((16 - (body.length % 16)) % 16)])
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()])
    const header = Buffer.alloc(4)
    header.writeUInt32LE(0x1c | (256 << 20), 0)
    expect(
      viewTextSection(Buffer.concat([header, stored, encrypted]))
        ?.subarray(0, body.length)
        .equals(body),
    ).toBe(true)
    // 모양이 다르면 풀지 않는다
    expect(viewTextSection(Buffer.alloc(300))).toBeNull()
  })
})
