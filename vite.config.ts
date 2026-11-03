import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { clientIp, sendWebResponse, toWebRequest } from './server/node-adapter.ts'

type Api = (req: Request, ctx: { ip: string; env: Record<string, string | undefined> }) => Promise<Response>

// 개발 중에는 Vite 서버가 /api 요청을 server/handler.ts로 넘긴다 (운영에서는 server/index.ts가 같은 일을 한다).
function devApi(env: Record<string, string>): Plugin {
  return {
    name: 'gwamok-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        try {
          // 서버 코드가 바뀌면 모듈 객체가 새로 생기므로 그때만 API를 다시 만든다 (요청 제한 상태는 유지)
          const mod = (await server.ssrLoadModule('/server/handler.ts')) as { createApi: () => Api }
          const store = globalThis as { __gwamokMod?: unknown; __gwamokApi?: Api }
          if (store.__gwamokMod !== mod || !store.__gwamokApi) {
            store.__gwamokMod = mod
            store.__gwamokApi = mod.createApi()
          }
          const api = store.__gwamokApi
          const origin = `http://${req.headers.host ?? 'localhost'}`
          const response = await api(toWebRequest(req, origin), { ip: clientIp(req, false), env: { ...process.env, ...env } })
          await sendWebResponse(res, response)
        } catch (e) {
          next(e)
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // VITE_ 접두사가 없는 값(AI 키 등)도 개발용 API에만 넘긴다. 클라이언트 번들에는 들어가지 않는다.
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), devApi(env)],
    build: {
      sourcemap: false,
      chunkSizeWarningLimit: 1400,
      rolldownOptions: {
        output: {
          // 대학 자료(1MB 남짓)는 코드보다 덜 바뀌므로 따로 묶어 캐시가 오래 가게 한다
          codeSplitting: { groups: [{ name: 'univ-data', test: /adiga2028\.json/ }] },
        },
      },
    },
  }
})
