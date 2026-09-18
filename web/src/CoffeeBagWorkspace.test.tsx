// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { createCoffeeBag } from './coffeeBag'
import { CoffeeBagWorkspace } from './CoffeeBagWorkspace'

afterEach(() => { cleanup(); localStorage.clear() })

function renderWorkspace() {
  return render(<CoffeeBagWorkspace bags={[{ ...createCoffeeBag(), id: 'bag-1', name: 'Test coffee', roastery: 'Test roastery', originalWeightG: 250, remainingWeightG: 250, roastedOn: '2026-09-01' }]} onDelete={async () => undefined} onSave={async () => undefined} onUse={() => undefined} />)
}

describe('CoffeeBagWorkspace controls', () => {
  it('opens, closes, and returns focus from the mobile controls menu', async () => {
    const user = userEvent.setup()
    renderWorkspace()
    const trigger = screen.getByRole('button', { name: 'Show bag controls' })

    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Bag controls' })).not.toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Bag controls' })).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  it('updates the persisted layout, filter, and sort choices through the mobile menu', async () => {
    const user = userEvent.setup()
    const { container } = renderWorkspace()
    const trigger = screen.getByRole('button', { name: 'Show bag controls' })

    await user.click(trigger)
    await user.click(within(screen.getByRole('dialog', { name: 'Bag controls' })).getByRole('button', { name: 'List' }))
    expect(container.querySelector('.bag-collection--list')).not.toBeNull()
    expect(localStorage.getItem('pourframe.coffeeBags.view.v1')).toBe('list')

    await user.click(trigger)
    await user.selectOptions(screen.getByLabelText('Show bags'), 'all')
    expect(localStorage.getItem('pourframe.coffeeBags.filter.v2')).toBe('all')
    expect(screen.queryByRole('dialog', { name: 'Bag controls' })).toBeNull()

    await user.click(trigger)
    await user.selectOptions(screen.getByLabelText('Sort bags'), 'updated')
    expect(localStorage.getItem('pourframe.coffeeBags.sort.v2')).toBe('updated')
  })

  it('keeps Add bag connected to the existing editor', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    await user.click(screen.getByRole('button', { name: 'Add bag' }))
    expect(await screen.findByRole('heading', { name: 'Add coffee bag' })).not.toBeNull()
  })
})
