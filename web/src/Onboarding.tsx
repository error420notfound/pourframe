import { useEffect, useId, useRef, useState } from 'react'
import { localAssetUrl, RemoteAssetImage } from './remoteAssets'

export type OnboardingStatus = 'unseen' | 'skipped' | 'completed'
export type OnboardingLaunch = 'automatic' | 'settings'

export const onboardingPreferenceKey = 'pourframe.onboarding.v1'

export function readOnboardingStatus(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): OnboardingStatus {
  if (!storage) return 'unseen'
  try {
    const value = storage.getItem(onboardingPreferenceKey)
    return value === 'skipped' || value === 'completed' ? value : 'unseen'
  } catch {
    return 'unseen'
  }
}

export function writeOnboardingStatus(status: Exclude<OnboardingStatus, 'unseen'>, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage) {
  if (!storage) return
  try { storage.setItem(onboardingPreferenceKey, status) } catch { /* preference remains in memory */ }
}

const introCards = [
  {
    image: 'images/onboarding/meet-pourframe.jpg',
    title: 'Meet PourFrame',
    description: 'A calmer way to brew with live guidance from your coffee, recipe, and two connected scales.',
  },
  {
    image: 'images/onboarding/two-scales.jpg',
    title: 'Two scales, one clear picture',
    description: 'The upper scale follows the dripper. The lower scale follows the carafe. Together they track water in and coffee out.',
  },
  {
    image: 'images/onboarding/guided-brew.jpg',
    title: 'Ready when you are',
    description: 'Keep beans and recipes together, then choose Prepare brew for step-by-step guidance.',
  },
] as const

const onboardingFallbackImage = localAssetUrl('assets/onboarding-fallback.svg')

interface OnboardingIntroProps {
  loading: boolean
  message: string
  onSkip: () => void
  onStartTour: () => void
}

export function OnboardingIntro({ loading, message, onSkip, onStartTour }: OnboardingIntroProps) {
  const [cardIndex, setCardIndex] = useState(0)
  const dialogRef = useRef<HTMLElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const card = introCards[cardIndex]
  const lastCard = cardIndex === introCards.length - 1

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onSkip()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [onSkip])

  return <div className="onboarding-backdrop">
    <section aria-describedby={descriptionId} aria-labelledby={titleId} aria-modal="true" className="onboarding-dialog" ref={dialogRef} role="dialog">
      <div className="onboarding-dialog__visual"><RemoteAssetImage alt="" fallbackSrc={onboardingFallbackImage} remotePath={card.image} /></div>
      <div className="onboarding-dialog__content">
        <div className="onboarding-dialog__progress" aria-label={`Introduction step ${cardIndex + 1} of ${introCards.length}`}>
          {introCards.map((item, index) => <span aria-hidden="true" className={index === cardIndex ? 'active' : ''} key={item.title} />)}
        </div>
        <p className="onboarding-dialog__eyebrow">Welcome to PourFrame</p>
        <h2 id={titleId}>{card.title}</h2>
        <p id={descriptionId}>{card.description}</p>
        {message ? <p className="onboarding-dialog__message" role="alert">{message}</p> : null}
        <div className="onboarding-dialog__actions">
          <button className="onboarding-skip" disabled={loading} onClick={onSkip} type="button">Skip for now</button>
          <div>
            {cardIndex > 0 ? <button className="brew-secondary" disabled={loading} onClick={() => setCardIndex((index) => index - 1)} type="button">Back</button> : null}
            <button className="brew-primary" disabled={loading} onClick={() => lastCard ? onStartTour() : setCardIndex((index) => index + 1)} type="button">
              {loading ? 'Preparing tour…' : lastCard ? 'Start guided setup' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
}

interface OnboardingExperienceProps {
  launch: OnboardingLaunch
  onClose: () => void
  onComplete: () => void
  onSkip: () => void
}

const tourRoutes = [null, '#device', '#device', '#beans', '#recipes', '#history', '#history'] as const

export function OnboardingExperience({ launch, onClose, onComplete, onSkip }: OnboardingExperienceProps) {
  const [introVisible, setIntroVisible] = useState(true)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const tourRef = useRef<import('driver.js').Driver | null>(null)
  const originHashRef = useRef('')
  const launchRef = useRef(launch)

  useEffect(() => {
    launchRef.current = launch
  }, [launch])

  useEffect(() => () => tourRef.current?.destroy(), [])

  const closeIntro = () => {
    if (launchRef.current === 'automatic') onSkip()
    onClose()
  }

  const startTour = async () => {
    if (loading) return
    setLoading(true)
    setMessage('')
    try {
      const [{ driver }, _styles] = await Promise.all([
        import('driver.js'),
        import('driver.js/dist/driver.css'),
      ])
      void _styles
      originHashRef.current = window.location.hash
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
      let finishing = false

      const finish = (completed: boolean) => {
        if (finishing) return
        finishing = true
        if (completed) {
          if (window.location.hash !== '#history') window.location.hash = '#history'
          onComplete()
        } else if (window.location.hash !== originHashRef.current) {
          window.location.hash = originHashRef.current || '#history'
        }
        tourRef.current?.destroy()
        tourRef.current = null
        onClose()
      }

      const moveTo = (index: number) => {
        const route = tourRoutes[index]
        if (route && window.location.hash !== route) window.location.hash = route
        window.requestAnimationFrame(() => tourRef.current?.moveTo(index))
      }

      const tour = driver({
        animate: !reducedMotion,
        duration: reducedMotion ? 0 : 260,
        allowClose: true,
        allowKeyboardControl: true,
        allowScroll: true,
        disableActiveInteraction: true,
        overlayClickBehavior: 'close',
        overlayColor: '#050705',
        overlayOpacity: 0.72,
        popoverClass: 'pourframe-tour',
        popoverOffset: 14,
        showButtons: ['next', 'previous', 'close'],
        showProgress: true,
        smoothScroll: !reducedMotion,
        stagePadding: 8,
        stageRadius: 12,
        waitForElement: 1800,
        progressText: '{{current}} of {{total}}',
        prevBtnText: 'Back',
        nextBtnText: 'Next',
        doneBtnText: 'Finish',
        onNextClick: (_element, _step, options) => moveTo((options.index ?? 0) + 1),
        onPrevClick: (_element, _step, options) => moveTo(Math.max(0, (options.index ?? 0) - 1)),
        onDoneClick: () => finish(true),
        onCloseClick: () => finish(false),
        onDestroyStarted: () => finish(false),
        steps: [
          {
            element: '[data-tour="settings"]',
            popover: {
              title: 'Device setup lives here',
              description: 'Check PourFrame, adjust preferences, and replay this introduction anytime from Settings.',
              side: 'bottom',
              align: 'end',
            },
          },
          {
            element: '[data-tour="connectivity"]',
            popover: {
              title: 'Confirm PourFrame is connected',
              description: 'Live weighing and calibration become available when the local device is online.',
              side: 'bottom',
              align: 'start',
            },
          },
          {
            element: '[data-tour="scales"]',
            popover: {
              title: 'Set up both scales',
              description: 'Use Upper / Dripper and Lower / Carafe to tare and calibrate each scale. This walkthrough never operates them for you.',
              side: 'top',
              align: 'center',
            },
          },
          {
            element: '[data-tour="beans-library"]',
            popover: {
              title: 'Add your coffee',
              description: 'Beans keeps the coffees you have on hand and their remaining weight ready for future brews.',
              side: 'bottom',
              align: 'start',
            },
          },
          {
            element: '[data-tour="recipe-library"]',
            popover: {
              title: 'Choose a recipe',
              description: 'Use a built-in recipe, import one, or create your own for the shared recipe library.',
              side: 'bottom',
              align: 'start',
            },
          },
          {
            element: '[data-tour="prepare-brew"]',
            popover: {
              title: 'Bring it together',
              description: 'Prepare brew lets you choose coffee and recipe before guided brewing starts.',
              side: 'top',
              align: 'end',
            },
          },
          {
            popover: {
              title: 'You’re ready',
              description: 'Explore at your own pace. You can replay this introduction anytime from Settings.',
              doneBtnText: 'Finish',
            },
          },
        ],
      })

      tourRef.current = tour
      setIntroVisible(false)
      tour.drive()
    } catch {
      setIntroVisible(true)
      setMessage('The guided setup could not start. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return introVisible ? <OnboardingIntro loading={loading} message={message} onSkip={closeIntro} onStartTour={() => void startTour()} /> : null
}
