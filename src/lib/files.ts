// 올린 편제표 파일(PDF·이미지)을 서버로 보낼 JPEG 데이터 URL로 바꾼다. 모두 브라우저 안에서 처리한다.

const MAX_SIDE = 1800
const MAX_PAGES = 4
const QUALITY = 0.85

function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/jpeg', QUALITY)
}

function fit(w: number, h: number): { w: number; h: number; scale: number } {
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h))
  return { w: Math.round(w * scale), h: Math.round(h * scale), scale }
}

async function imageToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const { w, h } = fit(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return canvasToDataUrl(canvas)
}

async function pdfToDataUrls(file: File): Promise<{ images: string[]; pages: number }> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useWasm: false })
  const doc = await task.promise
  const images: string[] = []
  try {
    for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGES); i++) {
      const page = await doc.getPage(i)
      const base = page.getViewport({ scale: 1 })
      const { scale } = fit(base.width * 2, base.height * 2)
      const viewport = page.getViewport({ scale: 2 * scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      await page.render({ canvas, viewport }).promise
      images.push(canvasToDataUrl(canvas))
      page.cleanup()
    }
    return { images, pages: doc.numPages }
  } finally {
    await task.destroy()
  }
}

export interface PreparedFiles {
  images: string[]
  /** PDF가 MAX_PAGES보다 길어 잘렸는지 */
  truncated: boolean
}

export async function prepareFiles(files: File[]): Promise<PreparedFiles> {
  const images: string[] = []
  let truncated = false
  for (const file of files) {
    if (images.length >= MAX_PAGES) {
      truncated = true
      break
    }
    if (file.size > 15 * 1024 * 1024) throw new Error('파일이 너무 커요. 15MB 이하로 올려 주세요.')
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      const out = await pdfToDataUrls(file)
      images.push(...out.images)
      if (out.pages > out.images.length) truncated = true
    } else if (/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type)) {
      images.push(await imageToDataUrl(file))
    } else {
      throw new Error('PDF나 이미지 파일만 올릴 수 있어요.')
    }
  }
  return { images: images.slice(0, MAX_PAGES), truncated }
}
