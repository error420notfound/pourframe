import { useEffect, useMemo, useState } from 'react'
import { ArrowPathIcon as RotateCcw, BeakerIcon as Coffee, BookmarkSquareIcon as Save, ListBulletIcon as List, PencilIcon as Pencil, PlusIcon as Plus, Squares2X2Icon as Grid2X2, StarIcon as Star, TrashIcon as Trash2 } from '@heroicons/react/24/solid'
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
import { Button, EmptyState, LibraryItemCard, Modal, PageHeader, SectionHeader } from './ui'

const sortPreferenceKey = 'pourframe.coffeeBags.sort.v2'
const filterPreferenceKey = 'pourframe.coffeeBags.filter.v2'
const viewPreferenceKey = 'pourframe.coffeeBags.view.v1'

function readPreference<T extends string>(key: string, valid: readonly T[], fallback: T): T {
  try { const value = localStorage.getItem(key); return valid.includes(value as T) ? value as T : fallback } catch { return fallback }
}

function RatingField({ label, value, onChange }: { label: string; value?: number; onChange: (value: number | undefined) => void }) {
  return <fieldset className="bag-rating"><legend>{label}</legend><div>{[1, 2, 3, 4].map((rating) => <button aria-pressed={value === rating} className={value === rating ? 'active' : ''} key={rating} onClick={() => onChange(value === rating ? undefined : rating)} type="button">{rating}</button>)}</div><small>{value ? `${value} of 4` : 'Not set'}</small></fieldset>
}

function BagForm({ draft, setDraft }: { draft: CoffeeBagRecord; setDraft: (bag: CoffeeBagRecord | ((current: CoffeeBagRecord) => CoffeeBagRecord)) => void }) {
  const toggleProcessing = (process: string) => setDraft((current) => current.processing.includes(process)
    ? { ...current, processing: current.processing.filter((item) => item !== process) }
    : current.processing.length >= 3 ? current : { ...current, processing: [...current.processing, process] })
  const customProcess = draft.processing.find((item) => !processingOptions.includes(item as typeof processingOptions[number])) ?? ''
  return <div className="bag-edit-form">
    <div className="bag-section"><div className="bag-section__heading"><span>Bag essentials</span><small>Required</small></div><div className="bag-form-grid">
      <label className="recipe-field bag-field--wide"><span>Coffee / roast name</span><input maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label className="recipe-field bag-field--wide"><span>Roastery</span><input maxLength={80} value={draft.roastery} onChange={(event) => setDraft({ ...draft, roastery: event.target.value })} /></label>
      <label className="recipe-field"><span>Roasted on</span><input type="date" value={draft.roastedOn} onChange={(event) => setDraft({ ...draft, roastedOn: event.target.value })} /></label>
      <label className="recipe-field"><span>Roast level</span><select value={draft.roastLevel} onChange={(event) => setDraft({ ...draft, roastLevel: event.target.value as CoffeeBagRecord['roastLevel'] })}>{roastLevels.map((level) => <option key={level}>{level}</option>)}</select></label>
      <label className="recipe-field"><span>Bean form</span><select value={draft.beanForm} onChange={(event) => setDraft({ ...draft, beanForm: event.target.value as CoffeeBagRecord['beanForm'], grind: event.target.value === 'Whole bean' ? undefined : draft.grind ?? 'Medium' })}>{beanForms.map((form) => <option key={form}>{form}</option>)}</select></label>
      {draft.beanForm === 'Pre-ground' ? <label className="recipe-field"><span>Grind size</span><select value={draft.grind ?? ''} onChange={(event) => setDraft({ ...draft, grind: event.target.value as CoffeeBagRecord['grind'] })}><option value="">Choose size</option>{grindSizes.map((size) => <option key={size}>{size}</option>)}</select></label> : null}
      <label className="recipe-field"><span>Original weight</span><div><input min="0.1" max="5000" step="0.1" type="number" value={draft.originalWeightG} onChange={(event) => setDraft({ ...draft, originalWeightG: Number(event.target.value) })} /><small>g</small></div></label>
      <label className="recipe-field"><span>Remaining weight</span><div><input min="0" max={draft.originalWeightG} step="0.1" type="number" value={draft.remainingWeightG} onChange={(event) => setDraft({ ...draft, remainingWeightG: Number(event.target.value) })} /><small>g</small></div></label>
    </div></div>
    <div className="bag-section"><div className="bag-section__heading"><span>Taste profile</span><small>Optional</small></div><div className="tasting-note-grid">{[0, 1, 2].map((index) => <label className="recipe-field" key={index}><span>Tasting note {index + 1}</span><input maxLength={40} value={draft.tastingNotes[index] ?? ''} onChange={(event) => setDraft((current) => { const notes = [...current.tastingNotes]; notes[index] = event.target.value; return { ...current, tastingNotes: notes } })} /></label>)}</div><div className="bag-rating-grid"><RatingField label="Acidity" value={draft.acidity} onChange={(acidity) => setDraft({ ...draft, acidity })} /><RatingField label="Bitterness" value={draft.bitterness} onChange={(bitterness) => setDraft({ ...draft, bitterness })} /></div></div>
    <div className="bag-section"><div className="bag-section__heading"><span>Origin and processing</span><small>Optional</small></div><div className="bag-form-grid"><label className="recipe-field"><span>Altitude</span><div><input min="0" max="5000" step="1" type="number" value={draft.altitudeM ?? ''} onChange={(event) => setDraft({ ...draft, altitudeM: event.target.value ? Number(event.target.value) : undefined })} /><small>m</small></div></label><label className="recipe-field"><span>Origin / location</span><input maxLength={80} value={draft.origin} onChange={(event) => setDraft({ ...draft, origin: event.target.value })} /></label><label className="recipe-field bag-field--wide"><span>Farm</span><input maxLength={80} value={draft.farm} onChange={(event) => setDraft({ ...draft, farm: event.target.value })} /></label></div><fieldset className="processing-field"><legend>Processing · choose up to three</legend><div>{processingOptions.filter((item) => item !== 'Other').map((process) => <button aria-pressed={draft.processing.includes(process)} className={draft.processing.includes(process) ? 'active' : ''} key={process} onClick={() => toggleProcessing(process)} type="button">{process}</button>)}</div><label><span>Other process</span><input maxLength={40} value={customProcess} onChange={(event) => setDraft((current) => { const presets = current.processing.filter((item) => processingOptions.includes(item as typeof processingOptions[number]) && item !== 'Other'); return { ...current, processing: event.target.value ? [...presets.slice(0, 2), event.target.value] : presets.slice(0, 3) } })} /></label></fieldset></div>
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
  const [refill, setRefill] = useState<CoffeeBagRecord | null>(null)
  const [refillWeight, setRefillWeight] = useState('250')
  const [refillRoastedOn, setRefillRoastedOn] = useState('')
  const [message, setMessage] = useState('')
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
  const saveRefill = async () => {
    if (!refill || !Number.isFinite(Number(refillWeight)) || Number(refillWeight) <= 0 || !refillRoastedOn) { setMessage('Add the new bag weight and roasted-on date.'); return }
    if (await save({ ...refill, originalWeightG: Number(refillWeight), remainingWeightG: Number(refillWeight), roastedOn: refillRoastedOn })) setRefill(null)
  }
  const renderGroup = (title: string, group: CoffeeBagRecord[]) => group.length ? <section className="library-group"><SectionHeader count={group.length} title={title} variant="compact" /><div className={`bag-collection bag-collection--${view}`}>{group.map((bag) => <BagCard bag={bag} key={bag.id} onOpen={() => setSelectedId(bag.id)} onStar={() => void toggleStar(bag)} view={view} />)}</div></section> : null

  return <section className="library-workspace coffee-library-workspace">
    <PageHeader actions={<Button className="new-recipe" onClick={() => setEditor(createCoffeeBag())} variant="secondary"><Plus aria-hidden="true" />Add bag</Button>} description="Keep the coffees you have on hand ready for your next brew." eyebrow="Shared inventory" title="Beans" variant="library" />
    <div className="library-controls"><div className="view-toggle" aria-label="Inventory layout"><button aria-pressed={view === 'grid'} onClick={() => setView('grid')} type="button"><Grid2X2 aria-hidden="true" />Grid</button><button aria-pressed={view === 'list'} onClick={() => setView('list')} type="button"><List aria-hidden="true" />List</button></div><label><span>Show</span><select onChange={(event) => setFilter(event.target.value as CoffeeBagFilter)} value={filter}><option value="active">Active</option><option value="depleted">Depleted</option><option value="all">All bags</option></select></label><label><span>Sort</span><select onChange={(event) => setSort(event.target.value as CoffeeBagSort)} value={sort}><option value="roast-oldest">Oldest roast</option><option value="roast-newest">Newest roast</option><option value="remaining-low">Lowest remaining</option><option value="remaining-high">Most remaining</option><option value="roastery">Roastery A–Z</option><option value="name">Coffee name A–Z</option><option value="updated">Recently updated</option></select></label></div>
    {renderGroup('Starred', starred)}
    {renderGroup(filter === 'all' ? 'All bags' : filter === 'active' ? 'Active bags' : 'Depleted bags', remaining)}
    {!starred.length && !remaining.length ? <EmptyState description="Add a bag or change the filter." icon={<Coffee aria-hidden="true" />} title="No coffee bags here yet" /> : null}
    <p className="library-message" role="status">{message}</p>
    {selected ? <Modal onClose={() => setSelectedId(null)} title={selected.name} variant="library"><div className="library-modal__body"><div className="modal-toolbar"><button className="library-star active" onClick={() => void toggleStar(selected)} type="button"><Star aria-hidden="true" />{selected.starred ? 'Starred' : 'Star'}</button><button onClick={() => setEditor(normalizeCoffeeBag(selected))} type="button"><Pencil aria-hidden="true" />Edit</button><button onClick={() => { setRefill(selected); setRefillWeight(String(selected.originalWeightG)); setRefillRoastedOn(selected.roastedOn) }} type="button"><RotateCcw aria-hidden="true" />Refill</button><button className="danger" onClick={() => void remove(selected)} type="button"><Trash2 aria-hidden="true" />Remove</button></div><div className="bag-weight-summary"><div><span>Remaining</span><strong>{selected.remainingWeightG.toFixed(1)} g</strong></div><div><span>Bag weight</span><strong>{selected.originalWeightG.toFixed(1)} g</strong></div></div><dl className="library-detail"><div><dt>Roastery</dt><dd>{selected.roastery}</dd></div><div><dt>Roasted</dt><dd>{new Date(`${selected.roastedOn}T00:00:00`).toLocaleDateString()}</dd></div><div><dt>Roast</dt><dd>{selected.roastLevel}</dd></div><div><dt>Origin</dt><dd>{selected.origin || 'Not recorded'}</dd></div><div><dt>Tasting notes</dt><dd>{selected.tastingNotes.filter(Boolean).join(' · ') || 'Not recorded'}</dd></div><div><dt>Processing</dt><dd>{selected.processing.join(' · ') || 'Not recorded'}</dd></div></dl><Button fullWidth onClick={() => { onUse(selected.id); setSelectedId(null) }} type="button">Use for next brew</Button></div></Modal> : null}
    {editor ? <Modal onClose={() => setEditor(null)} title={bags.some((bag) => bag.id === editor.id) ? 'Edit coffee bag' : 'Add coffee bag'} variant="library"><div className="library-modal__body"><BagForm draft={editor} setDraft={(value) => setEditor((current) => { if (!current) return current; return typeof value === 'function' ? value(current) : value })} /><Button fullWidth onClick={() => void save(editor)} type="button"><Save aria-hidden="true" />Save coffee bag</Button></div></Modal> : null}
    {refill ? <Modal onClose={() => setRefill(null)} title={`Refill ${refill.name}`} variant="library"><div className="library-modal__body refill-form"><p>This replaces the tracked bag with a new bag of the same coffee profile.</p><label className="recipe-field"><span>New bag weight</span><div><input min="0.1" onChange={(event) => setRefillWeight(event.target.value)} step="0.1" type="number" value={refillWeight} /><small>g</small></div></label><label className="recipe-field"><span>New roasted-on date</span><input onChange={(event) => setRefillRoastedOn(event.target.value)} type="date" value={refillRoastedOn} /></label><Button fullWidth onClick={() => void saveRefill()} type="button"><RotateCcw aria-hidden="true" />Replace tracked bag</Button></div></Modal> : null}
  </section>
}
