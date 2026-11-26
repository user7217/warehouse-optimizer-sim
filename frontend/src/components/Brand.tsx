/** The app mark: three rack columns with a robot between them (same drawing as favicon.svg). */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--card)" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="var(--border)" />
      <g fill="var(--accent)">
        <rect x="7" y="7" width="4" height="18" rx="1.2" />
        <rect x="14" y="7" width="4" height="18" rx="1.2" opacity=".55" />
        <rect x="21" y="7" width="4" height="18" rx="1.2" />
      </g>
      <rect x="14" y="17" width="4" height="4" rx="1" fill="var(--warn)" />
    </svg>
  )
}

export function Brand() {
  return (
    <div className="brand">
      <Logo />
      <span>
        Warehouse<b>Lab</b>
      </span>
    </div>
  )
}
