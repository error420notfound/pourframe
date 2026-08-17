import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { IdleBrewDock, SettingsControls } from './App'
import { Button, EmptyState, LibraryItemCard, Modal, PageHeader, SectionHeader } from './ui'

describe('shared UI primitives', () => {
  it('keeps page and section titles semantic', () => {
    const page = renderToStaticMarkup(<PageHeader description="Description" eyebrow="Eyebrow" title="Recipes" variant="library" />)
    const section = renderToStaticMarkup(<SectionHeader count={3} title="Starred" variant="compact" />)

    expect(page).toContain('<h2 class="page-title page-title--library">Recipes</h2>')
    expect(page).toContain('<p class="page-header__description">Description</p>')
    expect(section).toContain('<h3 class="section-title section-title--compact">Starred<small>3</small></h3>')
  })

  it('connects modal labeling and exposes a real close button', () => {
    const markup = renderToStaticMarkup(<Modal onClose={() => undefined} title="Settings"><p>Body</p></Modal>)
    const labelledBy = markup.match(/aria-labelledby="([^"]+)"/)?.[1]

    expect(labelledBy).toBeTruthy()
    expect(markup).toContain(`id="${labelledBy}"`)
    expect(markup).toContain('class="modal-title"')
    expect(markup).toContain('aria-label="Close"')
    expect(markup).toContain('type="button"')
  })

  it('maps button surfaces and variants without dropping native attributes', () => {
    const markup = renderToStaticMarkup(<Button disabled fullWidth surface="device" type="submit" variant="secondary">Save</Button>)

    expect(markup).toContain('class="button button--secondary button--full"')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('type="submit"')
  })

  it('preserves compact and full empty-state title semantics', () => {
    const compact = renderToStaticMarkup(<EmptyState description="Try again" icon={<span>Icon</span>} title="Nothing here" />)
    const full = renderToStaticMarkup(<EmptyState description="Start a brew" icon={<span>Icon</span>} title="No history" variant="full" />)

    expect(compact).toContain('<strong class="empty-state__title">Nothing here</strong>')
    expect(compact).not.toContain('<h3')
    expect(full).toContain('<h2 class="section-title empty-state__title">No history</h2>')
  })

  it('keeps library-card open and star controls separate', () => {
    const markup = renderToStaticMarkup(
      <LibraryItemCard label="House blend" onOpen={() => undefined} onToggleStar={() => undefined} starred>
        <strong className="card-title">House blend</strong>
      </LibraryItemCard>,
    )

    expect(markup.match(/<button/g)).toHaveLength(2)
    expect(markup).toContain('class="library-card__open"')
    expect(markup).toContain('aria-label="Unstar House blend"')
  })

  it('renders the idle dock with active hash navigation and a disabled prepare action', () => {
    const markup = renderToStaticMarkup(<IdleBrewDock disabled onPrepare={() => undefined} tab="history" />)

    expect(markup).toContain('aria-label="Brew navigation and preparation"')
    expect(markup).toContain('href="#history"')
    expect(markup).toContain('aria-current="page"')
    expect(markup).toContain('Prepare brew')
    expect(markup).toContain('disabled=""')
  })

  it('keeps settings preferences and destructive history management explicit', () => {
    const markup = renderToStaticMarkup(<SettingsControls canInstall={false} historyCount={0} onClearHistory={async () => undefined} onInstall={() => undefined} onOpenWifi={() => undefined} onThemePreferenceChange={() => undefined} onToggleSound={() => undefined} sound themePreference="system" wifiEnabled />)

    expect(markup).toContain('Brew sounds')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('Theme preference')
    expect(markup).toContain('Wi-Fi settings')
    expect(markup).toContain('Clear history')
    expect(markup).toContain('disabled=""')
    expect(markup).not.toContain('Install PourFrame')
  })
})
