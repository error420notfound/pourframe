import type { SVGProps } from 'react'

const common = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function SettingsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props} {...common}>
      <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" />
      <path d="m19.3 13.6 1.2 1-.1 1.1-2.3 2.3-1.1.1-1-1.2-1.6.7-.2 1.6-.9.7H10l-.9-.7-.2-1.6-1.6-.7-1 1.2-1.1-.1-2.3-2.3-.1-1.1 1.2-1-.7-1.6-1.6-.2-.7-.9V10l.7-.9 1.6-.2.7-1.6-1.2-1 .1-1.1 2.3-2.3 1.1-.1 1 1.2 1.6-.7.2-1.6L10 1h3.3l.9.7.2 1.6 1.6.7 1-1.2 1.1.1 2.3 2.3.1 1.1-1.2 1 .7 1.6 1.6.2.7.9v3.3l-.7.9-1.6.2-.7 1.6Z" />
    </svg>
  )
}

export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props} {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.2 2.6 2.6 5.7-6" />
    </svg>
  )
}

export function ClockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props} {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.2 1.8" />
    </svg>
  )
}

export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props} {...common}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  )
}
