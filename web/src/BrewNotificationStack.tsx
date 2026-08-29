import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { ArchiveRestore, BadgeCheck, PauseCircle, RefreshCw, Scale, TimerOff, TriangleAlert, WifiOff, X } from 'lucide-react'
import { insertNotification, liveBrewNotificationCandidates, shouldDismissForSwipe, type BrewNotificationCandidate, type BrewNotificationIcon, type LiveBrewNotificationState } from './brewNotifications'

interface StackNotification extends BrewNotificationCandidate {
  id: string
  createdAt: number
}

interface BrewNotificationStackProps {
  notifications: StackNotification[]
  persistentNotifications?: StackNotification[]
  onDismiss: (id: string) => void
  onPersistentDismiss?: (id: string) => void
  onReconnect: () => void
  onImportLegacy?: () => void
}

const iconMap = {
  refresh: RefreshCw,
  'wifi-off': WifiOff,
  'badge-check': BadgeCheck,
  alert: TriangleAlert,
  scale: Scale,
  'timer-off': TimerOff,
  pause: PauseCircle,
  archive: ArchiveRestore,
} satisfies Record<BrewNotificationIcon, typeof RefreshCw>

function BrewNotificationCard({ notification, onDismiss, onPersistentDismiss, onReconnect, onImportLegacy }: { notification: StackNotification; onDismiss: (id: string) => void; onPersistentDismiss: (id: string) => void; onReconnect: () => void; onImportLegacy: () => void }) {
  const [dragOffset, setDragOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ pointerId: number; startY: number; height: number } | null>(null)
  const dragOffsetRef = useRef(0)
  const Icon = iconMap[notification.icon]
  const style = dragging ? { '--notification-drag-y': `${dragOffset}px` } as CSSProperties : undefined
  const dismissNotification = () => notification.persistent ? onPersistentDismiss(notification.id) : onDismiss(notification.id)

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if ((event.target as Element).closest('button')) return
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, height: event.currentTarget.getBoundingClientRect().height }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
    dragOffsetRef.current = 0
    setDragOffset(0)
  }
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const nextOffset = Math.min(0, event.clientY - drag.startY)
    dragOffsetRef.current = nextOffset
    setDragOffset(nextOffset)
  }
  const finishDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (shouldDismissForSwipe(dragOffsetRef.current, drag.height)) onDismiss(notification.id)
    dragOffsetRef.current = 0
    setDragOffset(0)
  }

  return <article className={`brew-notification brew-notification--${notification.severity}${notification.persistent ? ' brew-notification--persistent' : ''}${dragging ? ' brew-notification--dragging' : ''}`} onPointerCancel={finishDrag} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finishDrag} role={notification.severity === 'error' ? 'alert' : 'status'} style={style}>
    <div className="brew-notification__icon" aria-hidden="true">{notification.retry ? <span>{notification.retry.attempt}/{notification.retry.maximum}</span> : <Icon />}</div>
    <strong>{notification.text}</strong>
    <div className="brew-notification__actions">
      {notification.action === 'reconnect' ? <button className="brew-notification__action" onClick={onReconnect} type="button">Reconnect</button> : null}
      {notification.action === 'import-legacy' ? <button className="brew-notification__action" onClick={onImportLegacy} type="button">Import to PourFrame</button> : null}
      <button aria-label="Dismiss notification" className="brew-notification__dismiss" onClick={(event) => { event.stopPropagation(); dismissNotification() }} type="button"><X aria-hidden="true" /></button>
    </div>
  </article>
}

export function BrewNotificationStack({ notifications, persistentNotifications = [], onDismiss, onPersistentDismiss = () => undefined, onReconnect, onImportLegacy = () => undefined }: BrewNotificationStackProps) {
  const visibleNotifications = [...persistentNotifications, ...notifications]
  if (!visibleNotifications.length) return null
  return <aside aria-label="PourFrame notifications" className="brew-notification-stack">{visibleNotifications.map((notification) => <BrewNotificationCard key={notification.id} notification={notification} onDismiss={onDismiss} onPersistentDismiss={onPersistentDismiss} onReconnect={onReconnect} onImportLegacy={onImportLegacy} />)}</aside>
}

export function useLiveBrewNotifications(state: LiveBrewNotificationState, fullscreenActive: boolean, onReconnect: () => void) {
  const [notifications, setNotifications] = useState<StackNotification[]>([])
  const notificationsRef = useRef(notifications)
  const cooldownRef = useRef(new Map<string, number>())
  const timersRef = useRef(new Map<string, number>())
  const replacementTimersRef = useRef(new Map<string, number>())
  const [pulse, setPulse] = useState(0)
  notificationsRef.current = notifications

  const remove = useCallback((id: string, suppressForMs = 0) => {
    const timer = timersRef.current.get(id)
    if (timer != null) window.clearTimeout(timer)
    timersRef.current.delete(id)
    setNotifications((current) => {
      const item = current.find((notification) => notification.id === id)
      if (item && suppressForMs) cooldownRef.current.set(item.key, Date.now() + suppressForMs)
      const next = current.filter((notification) => notification.id !== id)
      notificationsRef.current = next
      return next
    })
  }, [])

  const dismiss = useCallback((id: string) => remove(id, 6000), [remove])

  const present = useCallback((candidate: BrewNotificationCandidate) => {
    const now = Date.now()
    const current = notificationsRef.current
    const sameKey = current.filter((notification) => notification.key === candidate.key)
    const existingRetry = sameKey.find((notification) => notification.retry)
    const retryChanged = Boolean(candidate.retry && existingRetry && existingRetry.retry?.attempt !== candidate.retry.attempt)
    if (sameKey.length && !retryChanged) return
    if (!retryChanged && (cooldownRef.current.get(candidate.key) ?? 0) > now) return

    const notification: StackNotification = { ...candidate, id: `${candidate.key}:${candidate.retry?.attempt ?? now}`, createdAt: now }
    const protectedIds = retryChanged && existingRetry ? [existingRetry.id] : []
    setNotifications((items) => insertNotification(items, notification, protectedIds))
    cooldownRef.current.set(candidate.key, now + 6000)
    const timer = window.setTimeout(() => remove(notification.id), 6000)
    timersRef.current.set(notification.id, timer)

    if (retryChanged && existingRetry) {
      const replacement = window.setTimeout(() => remove(existingRetry.id), 300)
      replacementTimersRef.current.set(existingRetry.id, replacement)
    }
  }, [remove])

  const candidates = useMemo(() => liveBrewNotificationCandidates(state), [state])
  useEffect(() => {
    if (!state.active) return
    const timer = window.setInterval(() => setPulse((current) => current + 1), 1000)
    return () => window.clearInterval(timer)
  }, [state.active])
  useEffect(() => {
    for (const candidate of candidates) {
      if (fullscreenActive && candidate.severity !== 'error') continue
      present(candidate)
    }
  }, [candidates, fullscreenActive, present, pulse])
  useEffect(() => () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer))
    replacementTimersRef.current.forEach((timer) => window.clearTimeout(timer))
  }, [])

  const reconnect = useCallback(() => {
    onReconnect()
    notificationsRef.current.filter((notification) => notification.action === 'reconnect').forEach((notification) => dismiss(notification.id))
  }, [dismiss, onReconnect])

  return { notifications, dismiss, reconnect }
}
