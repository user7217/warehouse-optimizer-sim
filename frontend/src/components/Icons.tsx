// Small stroke icons (16px grid), coloured with currentColor.

const PATHS = {
  play: <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" stroke="none" />,
  pause: (
    <g fill="currentColor" stroke="none">
      <rect x="4" y="3.5" width="3" height="9" rx="0.8" />
      <rect x="9" y="3.5" width="3" height="9" rx="0.8" />
    </g>
  ),
  step: (
    <>
      <path d="M4 3.5v9l6-4.5z" fill="currentColor" stroke="none" />
      <path d="M12 3.5v9" />
    </>
  ),
  reset: (
    <>
      <path d="M3.5 8a4.5 4.5 0 1 0 1.4-3.3" />
      <path d="M3.5 2.5v3h3" />
    </>
  ),
  stop: <rect x="4" y="4" width="8" height="8" rx="1.2" fill="currentColor" stroke="none" />,
  bolt: <path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z" fill="currentColor" stroke="none" />,
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  check: <path d="m3.5 8.5 3 3 6-7" />,
  x: <path d="m4.5 4.5 7 7m0-7-7 7" />,
  trash: (
    <>
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
    </>
  ),
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  )
}
