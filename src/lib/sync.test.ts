import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, auth, myData } from './api'
import { AccountSync, type BaseSnap, hashText, type SyncHost, type SyncInfo } from './sync'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, myData: { get: vi.fn(), put: vi.fn() }, auth: { ...actual.auth, me: vi.fn() } }
})

const get = vi.mocked(myData.get)
const put = vi.mocked(myData.put)
const me = vi.mocked(auth.me)

// 화면 상태 대신 쓰는 단순한 상태: 고른 것 목록. 합치기는 둘을 모두 남긴다
type S = { items: string[] }
interface B extends BaseSnap {
  items: string[]
}
const hashOf = (items: string[]) => hashText(JSON.stringify({ items }))
const saved = (items: string[], updatedAt: string) => ({ saved: { data: { items }, updatedAt } })

function setup(initial: string[], base: B | null = null) {
  const box = { state: { items: initial } as S, base, reports: [] as SyncInfo[] }
  const host: SyncHost<S, B> = {
    owner: 1,
    read: () => box.state,
    apply: (next) => {
      box.state = next
    },
    payload: (s) => ({ items: s.items }),
    snapshot: (s, rev, hash) => ({ owner: 1, rev, hash, items: s ? s.items : [] }),
    merge: (raw, local) => {
      if (!raw) return { state: local, remote: null, dropped: [] }
      const remote = { items: (raw as S).items }
      return { state: { items: [...new Set([...remote.items, ...local.items])] }, remote, dropped: [] }
    },
    loadBase: () => box.base,
    saveBase: (b) => {
      box.base = b
    },
    report: (i) => {
      box.reports.push(i)
    },
    dropped: vi.fn(),
    accountChanged: vi.fn(),
  }
  const sync = new AccountSync(host)
  return { box, host, sync, last: () => box.reports[box.reports.length - 1]?.state }
}

/** 로그인 직후: 계정에 a가 r1 판으로 있고 이 기기도 같다 */
async function loaded(items = ['a']) {
  get.mockResolvedValueOnce(saved(items, 'r1'))
  const t = setup(items)
  t.sync.start()
  await vi.advanceTimersByTimeAsync(0)
  return t
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
  get.mockReset()
  put.mockReset()
  me.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('계정 저장', () => {
  it('처음 받기에 실패하면 간격을 두고 다시 받고, 받으면 이 기기 것을 올린다', async () => {
    get.mockRejectedValueOnce(new ApiError(0, '서버에 연결하지 못했어요.')).mockResolvedValueOnce({ saved: null })
    put.mockResolvedValue({ updatedAt: 'r1' })
    const t = setup(['a'])
    t.sync.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(t.last()).toBe('load-error')
    expect(put).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    expect(get).toHaveBeenCalledTimes(2)
    // 받은 뒤 바로 올린다 (가짜 타이머는 0ms 타이머를 1ms 뒤로 미룬다)
    await vi.advanceTimersByTimeAsync(10)
    expect(put).toHaveBeenCalledWith({ items: ['a'] }, null, { keepalive: false })
    expect(t.last()).toBe('saved')
    expect(t.box.base?.rev).toBe('r1')
  })

  it('계정과 같으면 올리지 않는다', async () => {
    const t = await loaded()
    await vi.advanceTimersByTimeAsync(5000)
    expect(put).not.toHaveBeenCalled()
    expect(t.last()).toBe('saved')
    expect(t.sync.isClean()).toBe(true)
  })

  it('못 올리면 다시 올리고, 인터넷이 돌아오면 바로 올린다 (이전 판을 base로)', async () => {
    const t = await loaded()
    put.mockRejectedValueOnce(new ApiError(0, '서버에 연결하지 못했어요.')).mockResolvedValueOnce({ updatedAt: 'r2' })
    t.box.state = { items: ['a', 'b'] }
    t.sync.changed()
    await vi.advanceTimersByTimeAsync(700)
    expect(t.last()).toBe('error')
    expect(t.sync.isClean()).toBe(false)
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)
    expect(put).toHaveBeenCalledTimes(2)
    expect(put.mock.calls[1]).toEqual([{ items: ['a', 'b'] }, 'r1', { keepalive: false }])
    expect(t.last()).toBe('saved')
    expect(t.box.base?.rev).toBe('r2')
  })

  it('409: 다른 곳에서 먼저 저장한 계정 것과 합쳐 새 판을 base로 다시 올린다', async () => {
    const t = await loaded()
    me.mockResolvedValue({ user: { id: 1 } as never })
    put.mockRejectedValueOnce(new ApiError(409, '다른 곳에서 먼저 저장했어요.', saved(['a', 'c'], 'r2'))).mockResolvedValueOnce({ updatedAt: 'r3' })
    t.box.state = { items: ['a', 'b'] }
    t.sync.changed()
    await vi.advanceTimersByTimeAsync(700)
    await vi.advanceTimersByTimeAsync(10)
    expect(put).toHaveBeenCalledTimes(2)
    expect(put.mock.calls[1]).toEqual([{ items: ['a', 'c', 'b'] }, 'r2', { keepalive: false }])
    expect(t.box.state.items).toEqual(['a', 'c', 'b'])
    expect(t.box.base?.rev).toBe('r3')
  })

  it('409인데 다른 탭에서 다른 계정으로 로그인했으면 그 계정에 합쳐 올리지 않는다', async () => {
    const t = await loaded()
    me.mockResolvedValue({ user: { id: 2 } as never })
    put.mockRejectedValueOnce(new ApiError(409, '다른 곳에서 먼저 저장했어요.', saved(['z'], 'r9')))
    t.box.state = { items: ['a', 'b'] }
    t.sync.changed()
    await vi.advanceTimersByTimeAsync(5000)
    expect(put).toHaveBeenCalledTimes(1)
    expect(t.host.accountChanged).toHaveBeenCalled()
    expect(t.box.state.items).toEqual(['a', 'b'])
  })

  it('서버가 거절한 내용(400)은 다시 보내지 않고, 고치면 다시 올린다', async () => {
    const t = await loaded()
    put.mockRejectedValueOnce(new ApiError(400, '저장할 내용이 맞지 않아요.')).mockResolvedValueOnce({ updatedAt: 'r2' })
    t.box.state = { items: ['a', 'b'] }
    t.sync.changed()
    await vi.advanceTimersByTimeAsync(700)
    expect(t.last()).toBe('rejected')
    expect(t.box.reports.at(-1)?.message).toBe('저장할 내용이 맞지 않아요.')
    t.sync.changed()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(put).toHaveBeenCalledTimes(1)
    t.box.state = { items: ['a'] }
    t.sync.changed()
    await vi.advanceTimersByTimeAsync(700)
    // 계정과 같아졌으니 올릴 것도 없다
    expect(put).toHaveBeenCalledTimes(1)
    expect(t.last()).toBe('saved')
  })

  it('401이면 멈춘다 (로그인 화면이 맡는다)', async () => {
    const t = await loaded()
    put.mockRejectedValue(new ApiError(401, '로그인이 필요해요.'))
    t.box.state = { items: ['a', 'b'] }
    t.sync.changed()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(put).toHaveBeenCalledTimes(1)
  })

  it('탭을 닫으면 기다리던 저장을 keepalive로 바로 보낸다', async () => {
    const t = await loaded()
    put.mockResolvedValue({ updatedAt: 'r2' })
    t.box.state = { items: ['a', 'b'] }
    t.sync.changed()
    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(0)
    expect(put).toHaveBeenCalledWith({ items: ['a', 'b'] }, 'r1', { keepalive: true })
  })

  it('로그아웃 전에 finish()는 기다리던 저장을 끝낸다', async () => {
    const t = await loaded()
    put.mockResolvedValue({ updatedAt: 'r2' })
    t.box.state = { items: ['a', 'b'] }
    t.sync.changed()
    await expect(t.sync.finish()).resolves.toBe(true)
    expect(put).toHaveBeenCalledTimes(1)
  })

  it('다른 탭이 같은 내용을 먼저 저장했으면 이 탭은 다시 올리지 않는다', async () => {
    const t = await loaded()
    t.box.state = { items: ['a', 'b'] }
    t.sync.changed(true)
    t.sync.adoptBase({ owner: 1, rev: 'r2', hash: hashOf(['a', 'b']), items: ['a', 'b'] })
    await vi.advanceTimersByTimeAsync(5000)
    expect(put).not.toHaveBeenCalled()
    // 예전 판은 받지 않는다
    t.sync.adoptBase({ owner: 1, rev: 'r1', hash: hashOf(['a']), items: ['a'] })
    expect(t.sync.isClean()).toBe(true)
  })

  it('이 기기 기준이 다른 계정 것이면 쓰지 않는다', () => {
    const t = setup(['a'], { owner: 2, rev: 'x', hash: hashOf(['a']), items: ['a'] })
    expect(t.sync.isClean()).toBe(false)
  })
})
