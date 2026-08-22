// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { beginStartup, canUseControlledCaches, deduplicate, markShellReady } from './startup'

describe('startup coordinator', () => {
  beforeEach(() => { document.body.innerHTML = '<div id="app-splash"></div>'; vi.useFakeTimers() })
  afterEach(() => vi.useRealTimers())

  it('removes a hung splash after the 750 ms watchdog', () => {
    beginStartup(); vi.advanceTimersByTime(750)
    expect(document.getElementById('app-splash')?.classList.contains('app-splash--hidden')).toBe(true)
    vi.advanceTimersByTime(220)
    expect(document.getElementById('app-splash')).toBeNull()
  })

  it('removes the splash as soon as the shell is committed', () => {
    markShellReady()
    expect(document.getElementById('app-splash')?.classList.contains('app-splash--hidden')).toBe(true)
  })

  it('deduplicates only simultaneous operations and permits later refreshes', async () => {
    const operation = vi.fn(async () => 'ready')
    const first = deduplicate('recipes', operation); const second = deduplicate('recipes', operation)
    await expect(Promise.all([first, second])).resolves.toEqual(['ready', 'ready'])
    await deduplicate('recipes', operation)
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('does not claim controlled caches for an insecure context', () => {
    expect(canUseControlledCaches()).toBe(false)
  })
})
