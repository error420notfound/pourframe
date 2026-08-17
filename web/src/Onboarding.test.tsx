import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { OnboardingIntro, onboardingPreferenceKey, readOnboardingStatus, writeOnboardingStatus } from './Onboarding'

function memoryStorage(initial?: string) {
  let value = initial ?? null
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => { value = next }),
  }
}

describe('onboarding preferences', () => {
  it('treats missing and unknown values as unseen', () => {
    expect(readOnboardingStatus(memoryStorage())).toBe('unseen')
    expect(readOnboardingStatus(memoryStorage('future-value'))).toBe('unseen')
    expect(readOnboardingStatus(null)).toBe('unseen')
  })

  it('reads terminal states and writes only the versioned preference', () => {
    expect(readOnboardingStatus(memoryStorage('skipped'))).toBe('skipped')
    expect(readOnboardingStatus(memoryStorage('completed'))).toBe('completed')
    const storage = memoryStorage()

    writeOnboardingStatus('completed', storage)

    expect(storage.setItem).toHaveBeenCalledWith(onboardingPreferenceKey, 'completed')
    expect(readOnboardingStatus(storage)).toBe('completed')
  })

  it('falls back safely when browser storage throws', () => {
    const storage = {
      getItem: vi.fn(() => { throw new Error('blocked') }),
      setItem: vi.fn(() => { throw new Error('blocked') }),
    }

    expect(readOnboardingStatus(storage)).toBe('unseen')
    expect(() => writeOnboardingStatus('skipped', storage)).not.toThrow()
  })
})

describe('onboarding introduction', () => {
  it('renders the first card as an accessible modal with a decorative local image', () => {
    const markup = renderToStaticMarkup(<OnboardingIntro loading={false} message="" onSkip={() => undefined} onStartTour={() => undefined} />)

    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('Meet PourFrame')
    expect(markup).toContain('Introduction step 1 of 3')
    expect(markup).toMatch(/<img alt="" src="[^\"]+meet-pourframe\.jpg"\/?>/)
    expect(markup).toContain('Skip for now')
    expect(markup).toContain('Next')
  })
})
