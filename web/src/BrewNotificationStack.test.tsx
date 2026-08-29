// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrewNotificationStack } from './BrewNotificationStack'

afterEach(() => cleanup())

describe('notification stack', () => {
  it('renders persistent legacy migration notifications with working actions', () => {
    const onImportLegacy = vi.fn()
    const onPersistentDismiss = vi.fn()

    render(
      <BrewNotificationStack
        notifications={[]}
        onDismiss={() => undefined}
        onImportLegacy={onImportLegacy}
        onPersistentDismiss={onPersistentDismiss}
        onReconnect={() => undefined}
        persistentNotifications={[{
          id: 'legacy-import',
          key: 'legacy-import',
          severity: 'warning',
          icon: 'archive',
          text: 'Browser-saved PourOver recipes were found.',
          action: 'import-legacy',
          persistent: true,
          createdAt: 0,
        }]}
      />,
    )

    expect(screen.getByText('Browser-saved PourOver recipes were found.')).toBeTruthy()
    expect(screen.getByRole('status').className).toContain('brew-notification--persistent')
    fireEvent.click(screen.getByRole('button', { name: 'Import to PourFrame' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(onImportLegacy).toHaveBeenCalledOnce()
    expect(onPersistentDismiss).toHaveBeenCalledWith('legacy-import')
  })
})
