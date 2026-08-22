import { ArrowTopRightOnSquareIcon as ExternalLink } from '@heroicons/react/24/solid'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import type { CoffeeBag } from './brewTypes'
import {
  applyCatalogCoffeeToBag,
  CATALOG_REPOSITORY_URL,
  catalogClient,
  catalogOrigin,
  filterCatalogCoffees,
  rankRoasteries,
  type CatalogClient,
  type CatalogCoffee,
  type CatalogCoffeeSummary,
  type CatalogRoasterySummary,
  type CatalogStatus,
} from './catalog'

type DraftSetter = (bag: CoffeeBag | ((current: CoffeeBag) => CoffeeBag)) => void

function normalized(value: string): string { return value.trim().toLocaleLowerCase() }
function initials(value: string): string { return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'PF' }
function labelStatus(status: CatalogStatus): string { return status.replace('-', ' ') }
function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
function formatPrice(coffee: CatalogCoffee): string | undefined {
  if (!coffee.price) return undefined
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: coffee.price.currency, maximumFractionDigits: 2 }).format(coffee.price.amount) } catch { return `${coffee.price.currency} ${coffee.price.amount}` }
}
function altitude(coffee: CatalogCoffee): string | undefined {
  if (coffee.altitudeM !== undefined) return `${coffee.altitudeM} m`
  if (coffee.altitudeRangeM) return `${coffee.altitudeRangeM.min}–${coffee.altitudeRangeM.max} m`
  return undefined
}

function CatalogImage({ alt, className, fallback, src }: { alt: string; className: string; fallback: ReactNode; src?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (!src || failed) return <span aria-hidden="true" className={`${className} ${className}--fallback`}>{fallback}</span>
  return <img alt={alt} className={className} onError={() => setFailed(true)} src={src} />
}

function StatusBadge({ status }: { status: CatalogStatus }) {
  return <span className={`catalog-status catalog-status--${status}`}>{labelStatus(status)}</span>
}

function CatalogCombobox<T extends { id: string; name: string }>({ id, label, value, suggestions, loading, onChange, onSelect, renderOption }: {
  id: string; label: string; value: string; suggestions: T[]; loading: boolean; onChange: (value: string) => void; onSelect: (item: T) => void; renderOption: (item: T) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const listId = `${id}-listbox`
  const visible = open && value.trim().length >= 2 && suggestions.length > 0
  const choose = (item: T) => { onSelect(item); setOpen(false); setActiveIndex(-1) }
  const status = loading ? 'Loading catalog suggestions.' : value.trim().length >= 2 ? `${suggestions.length} catalog suggestion${suggestions.length === 1 ? '' : 's'} available.` : 'Type at least two characters for catalog suggestions.'
  return <label className="recipe-field bag-field--wide catalog-combobox"><span>{label}</span><div className="catalog-combobox__input">
    <input aria-activedescendant={visible && activeIndex >= 0 ? `${id}-${suggestions[activeIndex].id}` : undefined} aria-autocomplete="list" aria-controls={listId} aria-expanded={visible} aria-haspopup="listbox" aria-label={label} autoComplete="off" maxLength={80} onBlur={() => requestAnimationFrame(() => setOpen(false))} onChange={(event) => { onChange(event.target.value); setOpen(true); setActiveIndex(-1) }} onFocus={() => setOpen(true)} onKeyDown={(event) => {
      if (event.key === 'Escape') { setOpen(false); setActiveIndex(-1); return }
      if (!suggestions.length || value.trim().length < 2) return
      if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActiveIndex((index) => (index + 1) % suggestions.length) }
      if (event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActiveIndex((index) => index <= 0 ? suggestions.length - 1 : index - 1) }
      if (event.key === 'Enter' && activeIndex >= 0) { event.preventDefault(); choose(suggestions[activeIndex]) }
    }} role="combobox" value={value} />
    {loading ? <span aria-hidden="true" className="catalog-combobox__loading">Loading…</span> : null}
  </div>
  {visible ? <ul aria-label={`${label} catalog suggestions`} className="catalog-combobox__list" id={listId} role="listbox">{suggestions.map((item, index) => <li aria-selected={index === activeIndex} id={`${id}-${item.id}`} key={item.id} onClick={() => choose(item)} onPointerDown={(event) => event.preventDefault()} role="option">{renderOption(item)}</li>)}</ul> : null}
  <span aria-live="polite" className="sr-only">{status}</span>
  </label>
}

function CatalogPreview({ coffee, roasteryName, onApply, onUseBagSize }: { coffee: CatalogCoffee; roasteryName: string; onApply: () => void; onUseBagSize: () => void }) {
  const price = formatPrice(coffee)
  const origin = catalogOrigin(coffee.origin)
  const coffeeAltitude = altitude(coffee)
  return <aside aria-labelledby="catalog-preview-title" className="catalog-preview">
    <div className="catalog-preview__heading"><CatalogImage alt="" className="catalog-preview__image" fallback={initials(coffee.name)} src={coffee.imageUrl} /><div><small>From PourFrame Catalog</small><h3 id="catalog-preview-title">{coffee.name}</h3><p>{roasteryName}</p><StatusBadge status={coffee.status} /></div></div>
    {coffee.description ? <p className="catalog-preview__description">{coffee.description}</p> : null}
    <dl className="catalog-preview__details">
      {origin ? <div><dt>Origin</dt><dd>{origin}</dd></div> : null}
      {coffee.farm ? <div><dt>Farm</dt><dd>{coffee.farm}</dd></div> : null}
      {coffee.processing?.length ? <div><dt>Processing</dt><dd>{coffee.processing.join(', ')}</dd></div> : null}
      {coffee.varieties?.length ? <div><dt>Variety</dt><dd>{coffee.varieties.join(', ')}</dd></div> : null}
      {coffee.roastLevel ? <div><dt>Roast level</dt><dd>{coffee.roastLevel}</dd></div> : null}
      {coffee.tastingNotes?.length ? <div><dt>Tasting notes</dt><dd>{coffee.tastingNotes.join(', ')}</dd></div> : null}
      {coffeeAltitude ? <div><dt>Altitude</dt><dd>{coffeeAltitude}</dd></div> : null}
      {price ? <div><dt>Catalog price</dt><dd>{price}</dd></div> : null}
      {coffee.bagSizeG ? <div><dt>Catalog bag size</dt><dd>{coffee.bagSizeG} g</dd></div> : null}
      <div><dt>Last updated</dt><dd>{formatDate(coffee.updatedAt)}</dd></div>
    </dl>
    <div className="catalog-preview__actions"><button onClick={onApply} type="button">Fill bag details</button>{coffee.bagSizeG ? <button className="catalog-preview__secondary" onClick={onUseBagSize} type="button">Use {coffee.bagSizeG} g as original weight</button> : null}</div>
    {coffee.productUrl ? <a className="catalog-preview__link" href={coffee.productUrl} rel="noreferrer" target="_blank">View product <ExternalLink aria-hidden="true" /></a> : null}
    <a className="catalog-preview__attribution" href={CATALOG_REPOSITORY_URL} rel="noreferrer" target="_blank">Catalog data by PourFrame Catalog <ExternalLink aria-hidden="true" /></a>
  </aside>
}

export function CoffeeCatalogFields({ draft, setDraft, client = catalogClient }: { draft: CoffeeBag; setDraft: DraftSetter; client?: CatalogClient }) {
  const messageId = useId()
  const [roasteries, setRoasteries] = useState<CatalogRoasterySummary[]>([])
  const [coffees, setCoffees] = useState<CatalogCoffeeSummary[]>([])
  const [selectedRoastery, setSelectedRoastery] = useState<CatalogRoasterySummary | null>(null)
  const [selectedCoffee, setSelectedCoffee] = useState<CatalogCoffeeSummary | null>(null)
  const [coffeeDetail, setCoffeeDetail] = useState<CatalogCoffee | null>(null)
  const [roasteryLoading, setRoasteryLoading] = useState(true)
  const [coffeeLoading, setCoffeeLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [catalogMessage, setCatalogMessage] = useState('')
  const roasteryAbort = useRef<AbortController | null>(null)
  const coffeeAbort = useRef<AbortController | null>(null)
  const detailAbort = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController(); roasteryAbort.current = controller
    const load = async () => {
      try {
        const result = await client.roasteries(controller.signal)
        if (controller.signal.aborted) return
        setRoasteries(result.data.roasteries); setRoasteryLoading(false)
        setCatalogMessage(result.discardedRecords ? 'Some catalog entries could not be shown.' : result.source === 'cached' ? 'Showing saved catalog results.' : '')
        void result.refresh?.then((fresh) => { if (!controller.signal.aborted) { setRoasteries(fresh.data.roasteries); setCatalogMessage(fresh.discardedRecords ? 'Some catalog entries could not be shown.' : '') } }).catch(() => { if (!controller.signal.aborted) setCatalogMessage('Catalog is unavailable — you can still enter this bag manually.') })
      } catch {
        if (!controller.signal.aborted) { setRoasteryLoading(false); setCatalogMessage('Catalog is unavailable — you can still enter this bag manually.') }
      }
    }
    void load()
    return () => controller.abort()
  }, [client])

  const roasteryMatches = useMemo(() => rankRoasteries(roasteries, draft.roastery), [draft.roastery, roasteries])
  const coffeeMatches = useMemo(() => filterCatalogCoffees(coffees, draft.name), [coffees, draft.name])
  const clearCoffee = () => { coffeeAbort.current?.abort(); detailAbort.current?.abort(); setCoffees([]); setSelectedCoffee(null); setCoffeeDetail(null); setCoffeeLoading(false); setDetailLoading(false) }

  const changeRoastery = (roastery: string) => {
    setDraft((current) => ({ ...current, roastery }))
    if (selectedRoastery && normalized(roastery) !== normalized(selectedRoastery.name)) { setSelectedRoastery(null); clearCoffee() }
  }
  const chooseRoastery = (roastery: CatalogRoasterySummary) => {
    setDraft((current) => ({ ...current, roastery: roastery.name })); setSelectedRoastery(roastery); clearCoffee(); setCoffeeLoading(true); setCatalogMessage('')
    coffeeAbort.current?.abort(); const controller = new AbortController(); coffeeAbort.current = controller
    void client.roasteryCoffees(roastery.path, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (result.data.roastery.id !== roastery.id) throw new Error('The selected roastery did not match the catalog index.')
      setCoffees(result.data.coffees); setCoffeeLoading(false)
      setCatalogMessage(result.discardedRecords ? 'Some catalog coffees could not be shown.' : result.source === 'cached' ? 'Showing saved coffee results.' : '')
      void result.refresh?.then((fresh) => { if (!controller.signal.aborted && fresh.data.roastery.id === roastery.id) { setCoffees(fresh.data.coffees); setCatalogMessage(fresh.discardedRecords ? 'Some catalog coffees could not be shown.' : '') } }).catch(() => { if (!controller.signal.aborted) setCatalogMessage('Coffee suggestions are unavailable — you can still enter this bag manually.') })
    }).catch(() => { if (!controller.signal.aborted) { setCoffeeLoading(false); setCatalogMessage('Coffee suggestions are unavailable — you can still enter this bag manually.') } })
  }
  const chooseCoffee = (coffee: CatalogCoffeeSummary) => {
    setDraft((current) => ({ ...current, name: coffee.name })); setSelectedCoffee(coffee); setCoffeeDetail(null); setDetailLoading(true); setCatalogMessage('')
    detailAbort.current?.abort(); const controller = new AbortController(); detailAbort.current = controller
    void client.coffee(coffee.path, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (result.data.id !== coffee.id || result.data.roasteryId !== selectedRoastery?.id) throw new Error('The selected coffee did not match the catalog detail.')
      setCoffeeDetail(result.data); setDetailLoading(false)
      void result.refresh?.then((fresh) => { if (!controller.signal.aborted && fresh.data.id === coffee.id && fresh.data.roasteryId === selectedRoastery?.id) setCoffeeDetail(fresh.data) }).catch(() => { if (!controller.signal.aborted) setCatalogMessage('Showing saved coffee details while offline.') })
    }).catch(() => { if (!controller.signal.aborted) { setDetailLoading(false); setCatalogMessage('This catalog coffee could not be loaded. You can still enter it manually.') } })
  }
  const changeCoffee = (name: string) => {
    setDraft((current) => ({ ...current, name }))
    if (selectedCoffee && normalized(name) !== normalized(selectedCoffee.name)) { detailAbort.current?.abort(); setSelectedCoffee(null); setCoffeeDetail(null); setDetailLoading(false) }
  }

  return <>
    <CatalogCombobox id="bag-roastery" label="Roastery" loading={roasteryLoading} onChange={changeRoastery} onSelect={chooseRoastery} renderOption={(roastery) => <><CatalogImage alt="" className="catalog-option__logo" fallback={initials(roastery.name)} src={roastery.logoUrl} /><span><strong>{roastery.name}</strong><small>{[roastery.city, roastery.country].filter(Boolean).join(', ') || 'PourFrame Catalog'}</small><em>From PourFrame Catalog</em></span></>} suggestions={roasteryMatches} value={draft.roastery} />
    <CatalogCombobox id="bag-coffee" label="Coffee / roast name" loading={coffeeLoading || detailLoading} onChange={changeCoffee} onSelect={chooseCoffee} renderOption={(coffee) => <span><strong>{coffee.name}</strong><small><StatusBadge status={coffee.status} /> <time dateTime={coffee.updatedAt}>Updated {formatDate(coffee.updatedAt)}</time></small><em>From PourFrame Catalog</em></span>} suggestions={coffeeMatches} value={draft.name} />
    {selectedRoastery && !coffees.length && !coffeeLoading ? <small className="catalog-hint">No catalog coffees are listed for this roastery yet. Manual entry remains available.</small> : null}
    {detailLoading ? <small className="catalog-hint" role="status">Loading catalog coffee details…</small> : null}
    {coffeeDetail ? <CatalogPreview coffee={coffeeDetail} onApply={() => { setDraft((current) => applyCatalogCoffeeToBag(current, coffeeDetail, selectedRoastery?.name ?? current.roastery)); setCatalogMessage('Catalog details were added. Your roast date, weights, bean form, grind, ratings, and star are unchanged.') }} onUseBagSize={() => setDraft((current) => ({ ...current, originalWeightG: coffeeDetail.bagSizeG ?? current.originalWeightG }))} roasteryName={selectedRoastery?.name ?? draft.roastery} /> : null}
    <small aria-describedby={messageId} className="catalog-hint" id={messageId} role="status">{catalogMessage}</small>
  </>
}
