import type { ReactNode } from 'react'

const Icon = ({ children }: { children: ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    width="22"
    height="22"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

export const BackIcon = () => (
  <Icon>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
)

export const CloseIcon = () => (
  <Icon>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
)

export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const ExpandIcon = () => (
  <Icon>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Icon>
)

export const ScissorsIcon = () => (
  <Icon>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M8.1 8.1L20 20M8.1 15.9L20 4" />
  </Icon>
)

export const PasteIcon = () => (
  <Icon>
    <rect x="6" y="4" width="12" height="17" rx="2.5" />
    <path d="M9 4.5V3.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
    <path d="M9.5 11h5M9.5 15h3" />
  </Icon>
)

export const ShareIcon = () => (
  <Icon>
    <path d="M12 15V3M7.5 7.5L12 3l4.5 4.5" />
    <path d="M5 12v6.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V12" />
  </Icon>
)

export const CopyIcon = () => (
  <Icon>
    <rect x="8" y="8" width="12" height="12" rx="2.5" />
    <path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" />
  </Icon>
)

export const DownloadIcon = () => (
  <Icon>
    <path d="M12 3v12M7.5 10.5L12 15l4.5-4.5" />
    <path d="M5 20h14" />
  </Icon>
)

export const TrashIcon = () => (
  <Icon>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7" />
    <path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" />
  </Icon>
)

/** The app mascot, used for the empty collection. */
export const StarMascot = ({ size = 140 }: { size?: number }) => (
  <svg viewBox="0 0 512 512" width={size} height={size} aria-hidden="true">
    <g transform="rotate(-10 256 256)">
      <path
        d="M256 98 L301 195 L404 208 L328 280 L348 383 L256 332 L164 383 L184 280 L108 208 L211 195 Z"
        fill="#3a0a4a"
        fillOpacity="0.18"
        stroke="#3a0a4a"
        strokeOpacity="0.18"
        strokeWidth="44"
        strokeLinejoin="round"
        transform="translate(0 14)"
      />
      <path
        d="M256 98 L301 195 L404 208 L328 280 L348 383 L256 332 L164 383 L184 280 L108 208 L211 195 Z"
        fill="#ffd23f"
        stroke="#fff"
        strokeWidth="44"
        strokeLinejoin="round"
        paintOrder="stroke"
      />
      <ellipse cx="232" cy="258" rx="13" ry="17" fill="#2a1840" />
      <ellipse cx="280" cy="258" rx="13" ry="17" fill="#2a1840" />
      <path d="M234 296 Q256 316 278 296" fill="none" stroke="#2a1840" strokeWidth="12" strokeLinecap="round" />
    </g>
  </svg>
)
