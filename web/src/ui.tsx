import { StarIcon as Star, XMarkIcon as X } from '@heroicons/react/24/solid'
import { gsap } from 'gsap'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

interface PageHeaderProps {
  title: string
  eyebrow?: string
  description?: string
  actions?: ReactNode
  titleId?: string
  variant?: 'default' | 'compact' | 'library'
  className?: string
}

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  titleId,
  variant = 'default',
  className,
}: PageHeaderProps) {
  return (
    <header className={classNames('page-header', `page-header--${variant}`, className)}>
      <div className="page-header__copy">
        {eyebrow ? <p className="brew-eyebrow">{eyebrow}</p> : null}
        <h2 className={classNames('page-title', `page-title--${variant}`)} id={titleId}>{title}</h2>
        {description ? <p className="page-header__description">{description}</p> : null}
      </div>
      {actions}
    </header>
  )
}

interface SectionHeaderProps {
  title: string
  eyebrow?: string
  count?: number
  trailing?: ReactNode
  titleId?: string
  variant?: 'card' | 'compact'
  className?: string
}

export function SectionHeader({
  title,
  eyebrow,
  count,
  trailing,
  titleId,
  variant = 'card',
  className,
}: SectionHeaderProps) {
  return (
    <header className={classNames('section-header', `section-header--${variant}`, className)}>
      <div>
        {eyebrow ? <p className="brew-eyebrow">{eyebrow}</p> : null}
        <h3 className={classNames('section-title', `section-title--${variant}`)} id={titleId}>
          {title}
          {count == null ? null : <small>{count}</small>}
        </h3>
      </div>
      {trailing}
    </header>
  )
}

interface ModalHeaderProps {
  title: string
  titleId: string
  onClose: () => void
  closeLabel?: string
}

export function ModalHeader({ title, titleId, onClose, closeLabel = 'Close' }: ModalHeaderProps) {
  return (
    <header className="modal__header">
      <h2 className="modal-title" id={titleId}>{title}</h2>
      <button aria-label={closeLabel} className="icon-button" onClick={onClose} type="button">
        <X aria-hidden="true" />
      </button>
    </header>
  )
}

interface ModalProps {
  title: string
  children: ReactNode
  onClose: () => void
  variant?: 'default' | 'library'
  closeLabel?: string
}

export function Modal({ title, children, onClose, variant = 'default', closeLabel }: ModalProps) {
  const titleId = useId()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className={classNames('modal-backdrop', variant === 'library' && 'library-modal-backdrop')}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className={classNames('modal', variant === 'library' && 'library-modal')}
        role="dialog"
      >
        <ModalHeader closeLabel={closeLabel} onClose={onClose} title={title} titleId={titleId} />
        {children}
      </section>
    </div>
  )
}

interface LibraryPanelProps {
  title: string
  children: ReactNode
  actions: ReactNode
  onEscape: () => void
}

/** A persistent, non-modal panel for library detail and editing flows. */
export function LibraryPanel({ title, children, actions, onEscape }: LibraryPanelProps) {
  const titleId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const context = gsap.context(() => {
      gsap.timeline()
        .fromTo(containerRef.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.26, ease: 'power2.out' })
        .fromTo(panelRef.current, { autoAlpha: 0, scale: 0.975, y: 22 }, { autoAlpha: 1, scale: 1, y: 0, duration: 0.34, ease: 'power3.out' }, 0)
    }, containerRef)
    return () => context.revert()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onEscape()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onEscape])

  const panel = (
    <div className="library-panel-container" onMouseDown={(event) => event.target === event.currentTarget && onEscape()} ref={containerRef}>
      <section aria-labelledby={titleId} className="library-panel" ref={panelRef} role="region">
        <div aria-hidden="true" className="library-panel__handle" />
        <header className="library-panel__header">
          <h2 className="modal-title library-panel__title" id={titleId}>{title}</h2>
          <div className="library-panel__actions">{actions}</div>
        </header>
        <div className="library-panel__body">{children}</div>
      </section>
    </div>
  )

  return typeof document === 'undefined' ? panel : createPortal(panel, document.body)
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  surface?: 'appliance' | 'device'
  variant?: 'primary' | 'secondary'
  fullWidth?: boolean
}

export function Button({
  surface = 'appliance',
  variant = 'primary',
  fullWidth = false,
  className,
  ...props
}: ButtonProps) {
  const surfaceClass = surface === 'device'
    ? `button button--${variant}`
    : variant === 'primary' ? 'brew-primary' : 'brew-secondary'

  return <button className={classNames(surfaceClass, fullWidth && 'button--full', className)} {...props} />
}

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description: string
  variant?: 'compact' | 'full'
}

export function EmptyState({ icon, title, description, variant = 'compact' }: EmptyStateProps) {
  return (
    <div className={classNames('empty-state', `empty-state--${variant}`)}>
      {icon}
      {variant === 'full'
        ? <h2 className="section-title empty-state__title">{title}</h2>
        : <strong className="empty-state__title">{title}</strong>}
      {variant === 'full'
        ? <p className="empty-state__description">{description}</p>
        : <span className="empty-state__description">{description}</span>}
    </div>
  )
}

interface LibraryItemCardProps {
  label: string
  starred: boolean
  onOpen: () => void
  onToggleStar: () => void
  children: ReactNode
  className?: string
  openClassName?: string
}

export function LibraryItemCard({
  label,
  starred,
  onOpen,
  onToggleStar,
  children,
  className,
  openClassName,
}: LibraryItemCardProps) {
  return (
    <article className={classNames('library-card', className)}>
      <button className={classNames('library-card__open', openClassName)} onClick={onOpen} type="button">
        {children}
      </button>
      <button
        aria-label={`${starred ? 'Unstar' : 'Star'} ${label}`}
        className={classNames('library-star', starred && 'active')}
        onClick={onToggleStar}
        type="button"
      >
        <Star aria-hidden="true" />
      </button>
    </article>
  )
}
