import { inflateRawSync } from 'node:zlib'

// 엑셀(xlsx)·한글(hwpx)용 작은 zip 읽기. 압축 폭탄 대비로 푼 크기·항목 수에 상한을 둔다.

export interface ZipLimits {
  maxEntryBytes: number
  maxTotalBytes: number
  maxEntries: number
}

const DEFAULT_LIMITS: ZipLimits = { maxEntryBytes: 20_000_000, maxTotalBytes: 60_000_000, maxEntries: 2_000 }

export class ZipError extends Error {}

export function isZip(buf: Buffer): boolean {
  return buf.length > 22 && buf.readUInt32LE(0) === 0x04034b50
}

/** 이름 → 내용. want로 고른 항목만 푼다 */
export function unzip(buf: Buffer, want: (name: string) => boolean, limits: ZipLimits = DEFAULT_LIMITS): Map<string, Buffer> {
  // EOCD(중앙 디렉터리 끝)를 뒤에서부터 찾는다. zip 주석(최대 0xffff바이트)만큼 앞까지
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ZipError('zip 끝을 찾지 못했어요.')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  if (count > limits.maxEntries) throw new ZipError('항목이 너무 많아요.')
  const out = new Map<string, Buffer>()
  let total = 0
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError('zip 목록이 깨졌어요.')
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const size = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    p += 46 + nameLen + extraLen + commentLen
    if (!want(name)) continue
    if (size > limits.maxEntryBytes || (total += size) > limits.maxTotalBytes) throw new ZipError('압축을 푼 크기가 너무 커요.')
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new ZipError('zip 항목이 깨졌어요.')
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const data = buf.subarray(start, start + compSize)
    if (method === 0) out.set(name, Buffer.from(data))
    else if (method === 8) out.set(name, inflateRawSync(data, { maxOutputLength: limits.maxEntryBytes }))
    else throw new ZipError('지원하지 않는 압축 방식이에요.')
  }
  return out
}
