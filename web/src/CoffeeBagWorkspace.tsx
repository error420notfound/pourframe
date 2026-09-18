import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowPathIcon as RotateCcw, BeakerIcon as Coffee, BookmarkSquareIcon as Save, EllipsisVerticalIcon as MoreVertical, ListBulletIcon as List, PencilIcon as Pencil, PlusIcon as Plus, Squares2X2Icon as Grid2X2, StarIcon as Star, TrashIcon as Trash2, XMarkIcon as X } from '@heroicons/react/24/solid'
import {
  beanForms,
  createCoffeeBag,
  filterCoffeeBags,
  grindSizes,
  isDepletedCoffeeBag,
  normalizeCoffeeBag,
  processingOptions,
  roastLevels,
  sortCoffeeBags,
  validateCoffeeBag,
  type CoffeeBagFilter,
  type CoffeeBagSort,
} from './coffeeBag'
import type { CoffeeBag as CoffeeBagRecord } from './brewTypes'
import { applyCatalogCoffeeToBag, catalogClient, filterCatalogCoffees, markCatalogUsed, rankRoasteries, type CatalogCoffee, type CatalogCoffeeSummary, type CatalogRoasterySummary } from './catalog'
import { CoffeeCatalogFields } from './CoffeeCatalogFields'
import { Button, EmptyState, LibraryItemCard, LibraryPanel, ModalSheet, PageHeader, SectionHeader } from './ui'

const sortPreferenceKey = 'pourframe.coffeeBags.sort.v2'
const filterPreferenceKey = 'pourframe.coffeeBags.filter.v2'
const viewPreferenceKey = 'pourframe.coffeeBags.view.v1'

function readPreference<T extends string>(key: string, valid: readonly T[], fallback: T): T {
  try { const value = localStorage.getItem(key); return valid.includes(value as T) ? value as T : fallback } catch { return fallback }
}

interface CoffeeBagControlsProps {
  filter: CoffeeBagFilter
  onAdd: (trigger: HTMLButtonElement) => void
  onFilterChange: (filter: CoffeeBagFilter) => void
  onSortChange: (sort: CoffeeBagSort) => void
  onViewChange: (view: 'grid' | 'list') => void
  sort: CoffeeBagSort
  view: 'grid' | 'list'
}

function CoffeeBagControls({ filter, onAdd, onFilterChange, onSortChange, onViewChange, sort, view }: CoffeeBagControlsProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const controlsRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const closeForOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !controlsRef.current?.contains(event.target)) setMenuOpen(false)
    }
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setMenuOpen(false)
      requestAnimationFrame(() => menuButtonRef.current?.focus())
    }
    document.addEventListener('mousedown', closeForOutsideClick)
    document.addEventListener('keydown', closeForEscape)
    return () => {
      document.removeEventListener('mousedown', closeForOutsideClick)
      document.removeEventListener('keydown', closeForEscape)
    }
  }, [menuOpen])

  const selectView = (nextView: 'grid' | 'list') => { onViewChange(nextView); setMenuOpen(false); requestAnimationFrame(() => menuButtonRef.current?.focus()) }
  const selectFilter = (nextFilter: CoffeeBagFilter) => { onFilterChange(nextFilter); setMenuOpen(false); requestAnimationFrame(() => menuButtonRef.current?.focus()) }
  const selectSort = (nextSort: CoffeeBagSort) => { onSortChange(nextSort); setMenuOpen(false); requestAnimationFrame(() => menuButtonRef.current?.focus()) }

  return <div className="bean-library-controls" ref={controlsRef}>
    <div className="bean-library-controls__action-row">
      <Button className="new-recipe" onClick={(event) => onAdd(event.currentTarget)} type="button" variant="secondary"><Plus aria-hidden="true" />Add bag</Button>
      <button aria-controls="beans-library-controls-menu" aria-expanded={menuOpen} aria-haspopup="dialog" aria-label="Show bag controls" className="bean-library-controls__more" onClick={() => setMenuOpen((open) => !open)} ref={menuButtonRef} type="button"><MoreVertical aria-hidden="true" /></button>
    </div>
    <div className="library-controls bean-library-controls__desktop">
      <div className="view-toggle" aria-label="Inventory layout"><button aria-pressed={view === 'grid'} onClick={() => onViewChange('grid')} type="button"><Grid2X2 aria-hidden="true" />Grid</button><button aria-pressed={view === 'list'} onClick={() => onViewChange('list')} type="button"><List aria-hidden="true" />List</button></div>
      <label><span>Show</span><select onChange={(event) => onFilterChange(event.target.value as CoffeeBagFilter)} value={filter}><option value="active">Active</option><option value="depleted">Depleted</option><option value="all">All bags</option></select></label>
      <label><span>Sort</span><select onChange={(event) => onSortChange(event.target.value as CoffeeBagSort)} value={sort}><option value="roast-oldest">Oldest roast</option><option value="roast-newest">Newest roast</option><option value="remaining-low">Lowest remaining</option><option value="remaining-high">Most remaining</option><option value="roastery">Roastery A–Z</option><option value="name">Coffee name A–Z</option><option value="updated">Recently updated</option></select></label>
    </div>
    {menuOpen ? <section aria-label="Bag controls" className="bean-library-controls__menu" id="beans-library-controls-menu" role="dialog">
      <div><span>Show layout</span><div className="bean-library-controls__layout"><button aria-pressed={view === 'grid'} onClick={() => selectView('grid')} type="button"><Grid2X2 aria-hidden="true" />Grid</button><button aria-pressed={view === 'list'} onClick={() => selectView('list')} type="button"><List aria-hidden="true" />List</button></div></div>
      <label><span>Show bags</span><select onChange={(event) => selectFilter(event.target.value as CoffeeBagFilter)} value={filter}><option value="active">Active bags</option><option value="depleted">Depleted</option><option value="all">All bags</option></select></label>
      <label><span>Sort bags</span><select onChange={(event) => selectSort(event.target.value as CoffeeBagSort)} value={sort}><option value="roast-oldest">Oldest roast</option><option value="roast-newest">Newest roast</option><option value="remaining-low">Lowest remaining</option><option value="remaining-high">Most remaining</option><option value="roastery">Roastery A–Z</option><option value="name">Coffee name A–Z</option><option value="updated">Recently updated</option></select></label>
    </section> : null}
  </div>
}

function RatingField({ label, value, onChange }: { label: string; value?: number; onChange: (value: number | undefined) => void }) {
  return <fieldset className="bag-rating"><legend>{label}</legend><div>{[1, 2, 3, 4].map((rating) => <button aria-pressed={value === rating} className={value === rating ? 'active' : ''} key={rating} onClick={() => onChange(value === rating ? undefined : rating)} type="button">{rating}</button>)}</div><small>{value ? `${value} of 4` : 'Not set'}</small></fieldset>
}

function CatalogAutocomplete<T extends { id: string; name: string }>({ id, label, value, suggestions, loading, onChange, onSelect }: {
  id: string; label: string; value: string; suggestions: T[]; loading: boolean; onChange: (value: string) => void; onSelect: (item: T) => void
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const visible = open && value.trim().length >= 2 && suggestions.length > 0
  const listId = `${id}-listbox`
  const choose = (item: T) => { onSelect(item); setOpen(false); setActiveIndex(-1) }
  return <label className="recipe-field bag-field--wide catalog-combobox"><span>{label}</span><div className="catalog-combobox__input"><input aria-activedescendant={visible && activeIndex >= 0 ? `${id}-${suggestions[activeIndex].id}` : undefined} aria-autocomplete="list" aria-controls={listId} aria-expanded={visible} autoComplete="off" maxLength={80} onChange={(event) => { onChange(event.target.value); setOpen(true); setActiveIndex(-1) }} onFocus={() => setOpen(true)} onKeyDown={(event) => {
    if (event.key === 'Escape') { setOpen(false); setActiveIndex(-1); return }
    if (!suggestions.length || value.trim().length < 2) return
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActiveIndex((index) => (index + 1) % suggestions.length) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActiveIndex((index) => index <= 0 ? suggestions.length - 1 : index - 1) }
    if (event.key === 'Enter' && activeIndex >= 0) { event.preventDefault(); choose(suggestions[activeIndex]) }
  }} role="combobox" value={value} /><span aria-live="polite" className="catalog-combobox__loading">{loading ? 'Loading catalog…' : ''}</span></div>{visible ? <ul aria-label={`${label} suggestions`} className="catalog-combobox__list" id={listId} role="listbox">{suggestions.map((item, index) => <li aria-selected={index === activeIndex} id={`${id}-${item.id}`} key={item.id} role="option"><button onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)} type="button"><strong>{item.name}</strong><small>From PourFrame Catalog</small></button></li>)}</ul> : null}</label>
}

function BagCatalogFields({ draft, setDraft }: { draft: CoffeeBagRecord; setDraft: (bag: CoffeeBagRecord | ((current: CoffeeBagRecord) => CoffeeBagRecord)) => void }) {
  const [roasteries, setRoasteries] = useState<CatalogRoasterySummary[]>([])
  const [coffees, setCoffees] = useState<CatalogCoffeeSummary[]>([])
  const [selectedRoastery, setSelectedRoastery] = useState<CatalogRoasterySummary | null>(null)
  const [selectedCoffee, setSelectedCoffee] = useState<CatalogCoffeeSummary | null>(null)
  const [coffeeDetail, setCoffeeDetail] = useState<CatalogCoffee | null>(null)
  const [roasteryLoading, setRoasteryLoading] = useState(true)
  const [coffeeLoading, setCoffeeLoading] = useState(false)
  const [catalogMessage, setCatalogMessage] = useState('')
  const roasteryAbort = useRef<AbortController | null>(null)
  const coffeeAbort = useRef<AbortController | null>(null)
  const detailAbort = useRef<AbortController | null>(null)

  useEffect(() => {
    markCatalogUsed()
    const controller = new AbortController(); roasteryAbort.current = controller
    const load = async () => {
      try {
        const result = await catalogClient.roasteries(controller.signal)
        if (controller.signal.aborted) return
        setRoasteries(result.data.roasteries); setRoasteryLoading(false)
        if (result.source === 'cached') setCatalogMessage('Catalog results are cached; checking for updates.')
        void result.refresh?.then((fresh) => { if (!controller.signal.aborted) { setRoasteries(fresh.data.roasteries); setCatalogMessage('') } }).catch(() => { if (!controller.signal.aborted) setCatalogMessage('Using saved catalog results while offline.') })
      } catch (error) { if (!controller.signal.aborted) { setRoasteryLoading(false); setCatalogMessage('Catalog is unavailable. You can still enter a roastery manually.') } }
    }
    void load()
    return () => controller.abort()
  }, [])

  const roasteryMatches = useMemo(() => rankRoasteries(roasteries, draft.roastery), [draft.roastery, roasteries])
  const coffeeMatches = useMemo(() => filterCatalogCoffees(coffees, draft.name), [coffees, draft.name])
  const clearCoffee = () => { coffeeAbort.current?.abort(); detailAbort.current?.abort(); setCoffees([]); setSelectedCoffee(null); setCoffeeDetail(null); setCoffeeLoading(false) }
  const changeRoastery = (roastery: string) => {
    setDraft({ ...draft, roastery })
    if (selectedRoastery && roastery.trim().toLocaleLowerCase() !== selectedRoastery.name.toLocaleLowerCase()) { setSelectedRoastery(null); clearCoffee() }
  }
  const chooseRoastery = (roastery: CatalogRoasterySummary) => {
    setDraft({ ...draft, roastery: roastery.name }); setSelectedRoastery(roastery); clearCoffee(); setCoffeeLoading(true); setCatalogMessage('')
    coffeeAbort.current?.abort(); const controller = new AbortController(); coffeeAbort.current = controller
    void catalogClient.roasteryCoffees(roastery.path, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      setCoffees(result.data.coffees); setCoffeeLoading(false)
      void result.refresh?.then((fresh) => { if (!controller.signal.aborted) setCoffees(fresh.data.coffees) }).catch(() => { if (!controller.signal.aborted) setCatalogMessage('Using saved coffee results while offline.') })
    }).catch(() => { if (!controller.signal.aborted) { setCoffeeLoading(false); setCatalogMessage('Coffee suggestions are unavailable. You can still enter a coffee manually.') } })
  }
  const chooseCoffee = (coffee: CatalogCoffeeSummary) => {
    setDraft({ ...draft, name: coffee.name }); setSelectedCoffee(coffee); setCoffeeDetail(null); setCoffeeLoading(true); setCatalogMessage('')
    detailAbort.current?.abort(); const controller = new AbortController(); detailAbort.current = controller
    void catalogClient.coffee(coffee.path, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (result.data.id !== coffee.id || result.data.roasteryId !== selectedRoastery?.id) throw new Error('This catalog coffee is invalid.')
      setCoffeeDetail(result.data); setCoffeeLoading(false)
      void result.refresh?.then((fresh) => { if (!controller.signal.aborted && fresh.data.id === coffee.id && fresh.data.roasteryId === selectedRoastery?.id) setCoffeeDetail(fresh.data) }).catch(() => { if (!controller.signal.aborted) setCatalogMessage('Using saved coffee details while offline.') })
    }).catch(() => { if (!controller.signal.aborted) { setCoffeeLoading(false); setCatalogMessage('This catalog coffee could not be loaded.') } })
  }
  const changeCoffee = (name: string) => {
    setDraft({ ...draft, name })
    if (selectedCoffee && name.trim().toLocaleLowerCase() !== selectedCoffee.name.toLocaleLowerCase()) { detailAbort.current?.abort(); setSelectedCoffee(null); setCoffeeDetail(null) }
  }
  return <><CatalogAutocomplete id="bag-roastery" label="Roastery" loading={roasteryLoading} onChange={changeRoastery} onSelect={chooseRoastery} suggestions={roasteryMatches} value={draft.roastery} /><CatalogAutocomplete id="bag-coffee" label="Coffee / roast name" loading={coffeeLoading} onChange={changeCoffee} onSelect={chooseCoffee} suggestions={coffeeMatches} value={draft.name} />{selectedRoastery && !coffees.length && !coffeeLoading ? <small className="catalog-hint">No catalog coffees are listed for this roastery yet. Manual entry remains available.</small> : null}{coffeeDetail ? <div className="catalog-autofill"><span>Catalog profile ready for {coffeeDetail.name}.</span><button onClick={() => { setDraft((current) => applyCatalogCoffeeToBag(current, coffeeDetail, selectedRoastery?.name ?? current.roastery)); setCatalogMessage('Catalog profile added. Your bag date, weights, form, grind, ratings, and star are unchanged.') }} type="button">Fill from catalog</button></div> : null}<small className="catalog-hint" role="status">{catalogMessage}</small></>
}

function BagForm({ draft, setDraft }: { draft: CoffeeBagRecord; setDraft: (bag: CoffeeBagRecord | ((current: CoffeeBagRecord) => CoffeeBagRecord)) => void }) {
  const toggleProcessing = (process: string) => setDraft((current) => current.processing.includes(process)
    ? { ...current, processing: current.processing.filter((item) => item !== process) }
    : current.processing.length >= 3 ? current : { ...current, processing: [...current.processing, process] })
  const customProcess = draft.processing.find((item) => !processingOptions.includes(item as typeof processingOptions[number])) ?? ''
  return <div className="bag-edit-form">
    <div className="bag-section"><div className="bag-section__heading"><span>Bag essentials</span><small>Required</small></div><div className="bag-form-grid">
      <CoffeeCatalogFields draft={draft} setDraft={setDraft} />
      <label className="recipe-field"><span>Roasted on</span><input type="date" value={draft.roastedOn} onChange={(event) => setDraft({ ...draft, roastedOn: event.target.value })} /></label>
      <label className="recipe-field"><span>Roast level</span><select value={draft.roastLevel} onChange={(event) => setDraft({ ...draft, roastLevel: event.target.value as CoffeeBagRecord['roastLevel'] })}>{roastLevels.map((level) => <option key={level}>{level}</option>)}</select></label>
      <label className="recipe-field"><span>Bean form</span><select value={draft.beanForm} onChange={(event) => setDraft({ ...draft, beanForm: event.target.value as CoffeeBagRecord['beanForm'], grind: event.target.value === 'Whole bean' ? undefined : draft.grind ?? 'Medium' })}>{beanForms.map((form) => <option key={form}>{form}</option>)}</select></label>
      {draft.beanForm === 'Pre-ground' ? <label className="recipe-field"><span>Grind size</span><select value={draft.grind ?? ''} onChange={(event) => setDraft({ ...draft, grind: event.target.value as CoffeeBagRecord['grind'] })}><option value="">Choose size</option>{grindSizes.map((size) => <option key={size}>{size}</option>)}</select></label> : null}
      <label className="recipe-field"><span>Original weight</span><div><input inputMode="decimal" min="0.1" max="5000" step="0.1" type="number" value={draft.originalWeightG} onChange={(event) => setDraft({ ...draft, originalWeightG: Number(event.target.value) })} /><small>g</small></div></label>
      <label className="recipe-field"><span>Remaining weight</span><div><input inputMode="decimal" min="0" max={draft.originalWeightG} step="0.1" type="number" value={draft.remainingWeightG} onChange={(event) => setDraft({ ...draft, remainingWeightG: Number(event.target.value) })} /><small>g</small></div></label>
    </div></div>
    <div className="bag-section"><div className="bag-section__heading"><span>Taste profile</span><small>Optional</small></div><div className="tasting-note-grid">{[0, 1, 2].map((index) => <label className="recipe-field" key={index}><span>Tasting note {index + 1}</span><input maxLength={40} value={draft.tastingNotes[index] ?? ''} onChange={(event) => setDraft((current) => { const notes = [...current.tastingNotes]; notes[index] = event.target.value; return { ...current, tastingNotes: notes } })} /></label>)}</div><div className="bag-rating-grid"><RatingField label="Acidity" value={draft.acidity} onChange={(acidity) => setDraft({ ...draft, acidity })} /><RatingField label="Bitterness" value={draft.bitterness} onChange={(bitterness) => setDraft({ ...draft, bitterness })} /></div></div>
    <div className="bag-section"><div className="bag-section__heading"><span>Origin and processing</span><small>Optional</small></div><div className="bag-form-grid"><label className="recipe-field"><span>Altitude</span><div><input inputMode="numeric" min="0" max="5000" step="1" type="number" value={draft.altitudeM ?? ''} onChange={(event) => setDraft({ ...draft, altitudeM: event.target.value ? Number(event.target.value) : undefined })} /><small>m</small></div></label><label className="recipe-field"><span>Origin / location</span><input maxLength={80} value={draft.origin} onChange={(event) => setDraft({ ...draft, origin: event.target.value })} /></label><label className="recipe-field bag-field--wide"><span>Farm</span><input maxLength={80} value={draft.farm} onChange={(event) => setDraft({ ...draft, farm: event.target.value })} /></label></div><fieldset className="processing-field"><legend>Processing · choose up to three</legend><div>{processingOptions.filter((item) => item !== 'Other').map((process) => <button aria-pressed={draft.processing.includes(process)} className={draft.processing.includes(process) ? 'active' : ''} key={process} onClick={() => toggleProcessing(process)} type="button">{process}</button>)}</div><label><span>Other process</span><input maxLength={40} value={customProcess} onChange={(event) => setDraft((current) => { const presets = current.processing.filter((item) => processingOptions.includes(item as typeof processingOptions[number]) && item !== 'Other'); return { ...current, processing: event.target.value ? [...presets.slice(0, 2), event.target.value] : presets.slice(0, 3) } })} /></label></fieldset></div>
  </div>
}

function BagCard({ bag, view, onOpen, onStar }: { bag: CoffeeBagRecord; view: 'grid' | 'list'; onOpen: () => void; onStar: () => void }) {
  return <LibraryItemCard className={`bag-card bag-card--${view} ${isDepletedCoffeeBag(bag) ? 'bag-card--depleted' : ''}`} label={bag.name} onOpen={onOpen} onToggleStar={onStar} openClassName="bag-card__open" starred={bag.starred}>
    <strong className="card-title">{bag.name}</strong><span>{bag.roastery}</span><b>{bag.remainingWeightG.toFixed(1)} / {bag.originalWeightG.toFixed(1)} g</b><small>{isDepletedCoffeeBag(bag) ? 'Depleted' : `Roasted ${new Date(`${bag.roastedOn}T00:00:00`).toLocaleDateString()}`}</small>
  </LibraryItemCard>
}

export function CoffeeBagWorkspace({ bags, onSave, onDelete, onUse }: { bags: CoffeeBagRecord[]; onSave: (bag: CoffeeBagRecord) => Promise<void>; onDelete: (id: string) => Promise<void>; onUse: (id: string) => void }) {
  const [sort, setSort] = useState(() => readPreference(sortPreferenceKey, ['roast-oldest', 'roast-newest', 'remaining-low', 'remaining-high', 'roastery', 'name', 'updated'] as const, 'roast-oldest'))
  const [filter, setFilter] = useState(() => readPreference(filterPreferenceKey, ['active', 'depleted', 'all'] as const, 'active'))
  const [view, setView] = useState(() => readPreference(viewPreferenceKey, ['grid', 'list'] as const, 'grid'))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editor, setEditor] = useState<CoffeeBagRecord | null>(null)
  const [editorBaseline, setEditorBaseline] = useState('')
  const [refill, setRefill] = useState<CoffeeBagRecord | null>(null)
  const [refillWeight, setRefillWeight] = useState('250')
  const [refillRoastedOn, setRefillRoastedOn] = useState('')
  const [refillBaseline, setRefillBaseline] = useState('')
  const [message, setMessage] = useState('')
  const sheetTriggerRef = useRef<HTMLElement | null>(null)
  const starred = useMemo(() => sortCoffeeBags(bags.filter((bag) => bag.starred), sort), [bags, sort])
  const remaining = useMemo(() => sortCoffeeBags(filterCoffeeBags(bags.filter((bag) => !bag.starred), filter), sort), [bags, filter, sort])
  const selected = bags.find((bag) => bag.id === selectedId) ?? null
  useEffect(() => { try { localStorage.setItem(sortPreferenceKey, sort) } catch { /* preference remains in memory */ } }, [sort])
  useEffect(() => { try { localStorage.setItem(filterPreferenceKey, filter) } catch { /* preference remains in memory */ } }, [filter])
  useEffect(() => { try { localStorage.setItem(viewPreferenceKey, view) } catch { /* preference remains in memory */ } }, [view])

  const save = async (bag: CoffeeBagRecord) => {
    const normalized = normalizeCoffeeBag(bag)
    const validation = validateCoffeeBag(normalized)
    if (!validation.valid) { setMessage(Object.values(validation.errors)[0] ?? 'Coffee bag is invalid.'); return false }
    try { await onSave(normalized); setEditor(null); setSelectedId(normalized.id); setMessage('Coffee bag saved on PourFrame.'); return true } catch (error) { setMessage(error instanceof Error ? error.message : 'Coffee bag could not be saved.'); return false }
  }
  const toggleStar = async (bag: CoffeeBagRecord) => { try { await onSave({ ...bag, starred: !bag.starred }) } catch (error) { setMessage(error instanceof Error ? error.message : 'Coffee bag could not be updated.') } }
  const remove = async (bag: CoffeeBagRecord) => { if (!window.confirm(`Remove ${bag.name}? Brew-history snapshots will be kept.`)) return; try { await onDelete(bag.id); setSelectedId(null) } catch (error) { setMessage(error instanceof Error ? error.message : 'Coffee bag could not be removed.') } }
  const openEditor = (bag: CoffeeBagRecord, keepDetail = false) => { setEditor(bag); setEditorBaseline(JSON.stringify(bag)); if (!keepDetail) setSelectedId(null) }
  const discardEditor = () => {
    setEditor(null)
  }
  const openRefill = (bag: CoffeeBagRecord) => {
    const weight = String(bag.originalWeightG)
    setRefill(bag); setRefillWeight(weight); setRefillRoastedOn(bag.roastedOn); setRefillBaseline(JSON.stringify({ weight, roastedOn: bag.roastedOn }))
  }
  const discardRefill = () => {
    setRefill(null)
  }
  const saveRefill = async () => {
    if (!refill || !Number.isFinite(Number(refillWeight)) || Number(refillWeight) <= 0 || !refillRoastedOn) { setMessage('Add the new bag weight and roasted-on date.'); return false }
    if (await save({ ...refill, originalWeightG: Number(refillWeight), remainingWeightG: Number(refillWeight), roastedOn: refillRoastedOn })) { setRefill(null); return true }
    return false
  }
  const renderGroup = (title: string, group: CoffeeBagRecord[]) => group.length ? <section className="library-group"><SectionHeader count={group.length} title={title} variant="compact" /><div className={`bag-collection bag-collection--${view}`}>{group.map((bag) => <BagCard bag={bag} key={bag.id} onOpen={() => setSelectedId(bag.id)} onStar={() => void toggleStar(bag)} view={view} />)}</div></section> : null

  return <section className="library-workspace coffee-library-workspace" data-tour="beans-library">
    <PageHeader className="library-workspace__header" description="Keep the coffees you have on hand ready for your next brew." eyebrow="Shared inventory" title="Beans" variant="library" />
    <CoffeeBagControls filter={filter} onAdd={(trigger) => { sheetTriggerRef.current = trigger; openEditor(createCoffeeBag()) }} onFilterChange={setFilter} onSortChange={setSort} onViewChange={setView} sort={sort} view={view} />
    {renderGroup('Starred', starred)}
    {renderGroup(filter === 'all' ? 'All bags' : filter === 'active' ? 'Active bags' : 'Depleted bags', remaining)}
    {!starred.length && !remaining.length ? <EmptyState description="Add a bag or change the filter." icon={<Coffee aria-hidden="true" />} title="No coffee bags here yet" /> : null}
    <p className="library-message" role="status">{message}</p>
    {editor ? <ModalSheet
      actions={<button className="modal-sheet__save" onClick={() => void save(editor)} type="button"><Save aria-hidden="true" />Save coffee bag</button>}
      dirty={JSON.stringify(editor) !== editorBaseline}
      onClose={discardEditor}
      onSave={() => save(editor)}
      triggerRef={sheetTriggerRef}
      title={bags.some((bag) => bag.id === editor.id) ? 'Edit coffee bag' : 'Add coffee bag'}
    >
      <BagForm draft={editor} setDraft={(value) => setEditor((current) => { if (!current) return current; return typeof value === 'function' ? value(current) : value })} />
    </ModalSheet> : refill ? <ModalSheet
      actions={<button className="modal-sheet__save" onClick={() => void saveRefill()} type="button"><RotateCcw aria-hidden="true" />Save refill</button>}
      dirty={JSON.stringify({ weight: refillWeight, roastedOn: refillRoastedOn }) !== refillBaseline}
      onClose={discardRefill}
      onSave={saveRefill}
      title={`Refill ${refill.name}`}
    >
      <div className="refill-form"><p>This replaces the tracked bag with a new bag of the same coffee profile.</p><label className="recipe-field"><span>New bag weight</span><div><input inputMode="decimal" min="0.1" onChange={(event) => setRefillWeight(event.target.value)} step="0.1" type="number" value={refillWeight} /><small>g</small></div></label><label className="recipe-field"><span>New roasted-on date</span><input onChange={(event) => setRefillRoastedOn(event.target.value)} type="date" value={refillRoastedOn} /></label></div>
    </ModalSheet> : selected ? <LibraryPanel
      actions={<><div className="library-panel__action-group"><button aria-label={selected.starred ? `Unstar ${selected.name}` : `Star ${selected.name}`} className={selected.starred ? 'library-panel-action library-star active' : 'library-panel-action library-star'} data-tooltip={selected.starred ? 'Unstar' : 'Star'} onClick={() => void toggleStar(selected)} type="button"><Star aria-hidden="true" /></button></div><span aria-hidden="true" className="library-panel__separator" /><div className="library-panel__action-group"><button aria-label="Edit coffee bag" className="library-panel-action" data-tooltip="Edit" onClick={(event) => { sheetTriggerRef.current = event.currentTarget; openEditor(normalizeCoffeeBag(selected), true) }} type="button"><Pencil aria-hidden="true" /></button><button aria-label="Refill coffee bag" className="library-panel-action" data-tooltip="Refill" onClick={(event) => { sheetTriggerRef.current = event.currentTarget; openRefill(selected) }} type="button"><RotateCcw aria-hidden="true" /></button></div><span aria-hidden="true" className="library-panel__separator" /><div className="library-panel__action-group"><button aria-label={`Remove ${selected.name}`} className="library-panel-action library-panel-action--danger" data-tooltip="Remove" onClick={() => void remove(selected)} type="button"><Trash2 aria-hidden="true" /></button></div><span aria-hidden="true" className="library-panel__separator" /><button aria-label="Close coffee bag details" className="library-panel-action" data-tooltip="Close" onClick={() => setSelectedId(null)} type="button"><X aria-hidden="true" /></button></>}
      onEscape={() => setSelectedId(null)}
      title={selected.name}
    >
      <div className="bag-weight-summary"><div><span>Remaining</span><strong>{selected.remainingWeightG.toFixed(1)} g</strong></div><div><span>Bag weight</span><strong>{selected.originalWeightG.toFixed(1)} g</strong></div></div><dl className="library-detail"><div><dt>Roastery</dt><dd>{selected.roastery}</dd></div><div><dt>Roasted</dt><dd>{new Date(`${selected.roastedOn}T00:00:00`).toLocaleDateString()}</dd></div><div><dt>Roast</dt><dd>{selected.roastLevel}</dd></div><div><dt>Origin</dt><dd>{selected.origin || 'Not recorded'}</dd></div><div><dt>Tasting notes</dt><dd>{selected.tastingNotes.filter(Boolean).join(' · ') || 'Not recorded'}</dd></div><div><dt>Processing</dt><dd>{selected.processing.join(' · ') || 'Not recorded'}</dd></div></dl><Button fullWidth onClick={() => { onUse(selected.id); setSelectedId(null) }} type="button">Use for next brew</Button>
    </LibraryPanel> : null}
  </section>
}
