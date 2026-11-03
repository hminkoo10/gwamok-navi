import type { SVGProps } from 'react'

// 선 굵기 1.6의 16px 아이콘. 장식이 아니라 버튼 뜻을 돕는 용도로만 쓴다.

type P = SVGProps<SVGSVGElement>

const base = (props: P) => ({
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...props,
})

export const IconShare = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 10V2.5M5 5.5l3-3 3 3M3 9v3.5A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V9" />
  </svg>
)
export const IconPrint = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 6V2h7v4M4.5 11.5h-1A1.5 1.5 0 0 1 2 10V7.5A1.5 1.5 0 0 1 3.5 6h9A1.5 1.5 0 0 1 14 7.5V10a1.5 1.5 0 0 1-1.5 1.5h-1M4.5 9.5h7V14h-7z" />
  </svg>
)
export const IconInfo = (p: P) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M8 7.2v3.6M8 5.1v.1" />
  </svg>
)
export const IconPlus = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 3v10M3 8h10" />
  </svg>
)
export const IconClose = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
)
export const IconPin = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 2.5h4M7 2.5v3.8L4.6 8.7V10h6.8V8.7L9 6.3V2.5M8 10v3.5" />
  </svg>
)
export const IconSearch = (p: P) => (
  <svg {...base(p)}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14" />
  </svg>
)
export const IconChevron = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 6.5L8 10l3.5-3.5" />
  </svg>
)
export const IconEdit = (p: P) => (
  <svg {...base(p)}>
    <path d="M10.5 2.5l3 3L6 13H3v-3z" />
  </svg>
)
export const IconTrash = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.6 8.4a1.2 1.2 0 0 0 1.2 1.1h4.4a1.2 1.2 0 0 0 1.2-1.1l.6-8.4" />
  </svg>
)
export const IconUpload = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10.5v2A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5v-2" />
  </svg>
)
export const IconMinus = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 8h9" />
  </svg>
)
export const IconMenu = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
  </svg>
)
export const IconArrow = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </svg>
)
export const IconBack = (p: P) => (
  <svg {...base(p)}>
    <path d="M13 8H3M7 4L3 8l4 4" />
  </svg>
)
export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 8.5l3 3 7-7" />
  </svg>
)
export const IconAlert = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 5v3.5M8 11h.01M7.1 2.5L1.8 12a1 1 0 0 0 .9 1.5h10.6a1 1 0 0 0 .9-1.5L8.9 2.5a1 1 0 0 0-1.8 0z" />
  </svg>
)
