import { useEffect, useMemo, useState } from 'react'
import { Coffee, Save } from 'lucide-react'
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

const sortPreferenceKey = 'pourframe.coffeeBags.sort.v1'
const filterPreferenceKey = 'pourframe.coffeeBags.filter.v1'

function loadSortPreference(): CoffeeBagSort {
  try {
    const value = localStorage.getItem(sortPreferenceKey)
    if (value === 'roast-newest' || value === 'remaining-low' || value === 'remaining-high' || value === 'roastery' || value === 'name' || value === 'updated') return value
  } catch { /* use default */ }
  return 'roast-oldest'
}

function loadFilterPreference(): CoffeeBagFilter {
  try {
    const value = localStorage.getItem(filterPreferenceKey)
    if (value === 'all' || value === 'depleted') return value
  } catch { /* use default */ }
  return 'active'
}

function RatingField({ label, value, onChange }: { label: string; value?: number; onChange: (value: number | undefined) => void }) {
  return <fieldset className="bag-rating">
    <legend>{label}</legend>
    <div>
      {[1, 2, 3, 4].map((rating) => <button aria-pressed={value === rating} className={value === rating ? 'active' : ''} key={rating} onClick={() => onChange(value === rating ? undefined : rating)} type="button">{rating}</button>)}
    </div>
    <small>{value ? `${value} of 4` : 'Not set'}</small>
  </fieldset>
}

export function CoffeeBagWorkspace({ bags, onSave, onDelete }: { bags: CoffeeBagRecord[]; onSave: (bag: CoffeeBagRecord) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const [sort, setSort] = useState<CoffeeBagSort>(loadSortPreference)
  const [filter, setFilter] = useState<CoffeeBagFilter>(loadFilterPreference)
  const sorted = useMemo(() => sortCoffeeBags(filterCoffeeBags(bags, filter), sort), [bags, filter, sort])
  const [selectedId, setSelectedId] = useState<string | null>(() => sorted[0]?.id ?? null)
  const [draft, setDraft] = useState<CoffeeBagRecord>(() => sorted[0] ?? createCoffeeBag())
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!selectedId) return
    const current = bags.find((bag) => bag.id === selectedId)
    if (current) setDraft(normalizeCoffeeBag(current))
  }, [bags, selectedId])

  useEffect(() => {
    try { localStorage.setItem(sortPreferenceKey, sort) } catch { /* preference remains in memory */ }
  }, [sort])

  useEffect(() => {
    try { localStorage.setItem(filterPreferenceKey, filter) } catch { /* preference remains in memory */ }
  }, [filter])

  const select = (bag: CoffeeBagRecord) => {
    setSelectedId(bag.id)
    setDraft(normalizeCoffeeBag(bag))
    setMessage('')
  }

  const makeNew = () => {
    setSelectedId(null)
    setDraft(createCoffeeBag())
    setMessage('Enter the coffee bag details.')
  }

  const save = async () => {
    const normalized = normalizeCoffeeBag(draft)
    const validation = validateCoffeeBag(normalized)
    if (!validation.valid) {
      setMessage(Object.values(validation.errors)[0] ?? 'Coffee bag is invalid.')
      return
    }
    setSaving(true); setMessage('Saving to PourFrame…')
    try {
      await onSave(normalized)
      setSelectedId(normalized.id)
      setDraft(normalized)
      setMessage('Coffee bag saved on PourFrame.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Coffee bag could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (bag: CoffeeBagRecord) => {
    if (!window.confirm(`Delete ${bag.name}? Brew-history snapshots will be kept.`)) return
    try {
      await onDelete(bag.id)
      if (selectedId === bag.id) makeNew()
      setMessage('Coffee bag deleted.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Coffee bag could not be deleted.')
    }
  }

  const toggleProcessing = (process: string) => {
    setDraft((current) => {
      const selected = current.processing.includes(process)
      if (selected) return { ...current, processing: current.processing.filter((item) => item !== process) }
      if (current.processing.length >= 3) return current
      return { ...current, processing: [...current.processing, process] }
    })
  }

  const customProcess = draft.processing.find((item) => !processingOptions.includes(item as typeof processingOptions[number])) ?? ''
  const setCustomProcess = (value: string) => {
    setDraft((current) => {
      const presets = current.processing.filter((item) => processingOptions.includes(item as typeof processingOptions[number]) && item !== 'Other')
      return { ...current, processing: value ? [...presets.slice(0, 2), value] : presets.slice(0, 3) }
    })
  }

  return <div className="recipe-workspace coffee-bag-workspace">
    <aside className="recipe-library coffee-bag-library">
      <div><p className="brew-eyebrow">Shared inventory</p><h2>Coffee bags</h2></div>
      <button className="new-recipe" onClick={makeNew}><Coffee aria-hidden="true" />Add coffee bag</button>
      <div className="bag-list-controls">
        <label><span>Show</span><select value={filter} onChange={(event) => setFilter(event.target.value as CoffeeBagFilter)}><option value="active">Active</option><option value="depleted">Depleted</option><option value="all">All bags</option></select></label>
        <label><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value as CoffeeBagSort)}><option value="roast-oldest">Oldest roast</option><option value="roast-newest">Newest roast</option><option value="remaining-low">Lowest remaining</option><option value="remaining-high">Most remaining</option><option value="roastery">Roastery A–Z</option><option value="name">Coffee name A–Z</option><option value="updated">Recently updated</option></select></label>
      </div>
      {sorted.length ? <ul>{sorted.map((bag) => <li key={bag.id}>
        <button className={bag.id === selectedId ? 'active' : ''} onClick={() => select(bag)}>
          <strong>{bag.name}</strong>
          <span>{bag.roastery} · {bag.remainingWeightG.toFixed(1)} / {bag.originalWeightG.toFixed(1)} g</span>
          <small>{isDepletedCoffeeBag(bag) ? 'Depleted' : `Roasted ${new Date(`${bag.roastedOn}T00:00:00`).toLocaleDateString()}`}</small>
        </button>
        <button aria-label={`Delete ${bag.name}`} className="recipe-delete" onClick={() => void remove(bag)}>×</button>
      </li>)}</ul> : <div className="bag-empty"><Coffee aria-hidden="true" /><strong>No {filter === 'all' ? '' : `${filter} `}coffee bags</strong><span>Add a bag or change the filter.</span></div>}
    </aside>

    <section className="recipe-editor coffee-bag-editor">
      <div className="editor-heading"><div><p className="brew-eyebrow">{isDepletedCoffeeBag(draft) ? 'Depleted bag' : 'Coffee profile'}</p><h2>{selectedId ? 'Edit coffee bag' : 'Add coffee bag'}</h2></div><button className="brew-primary" disabled={saving} onClick={() => void save()}><Save aria-hidden="true" />{saving ? 'Saving…' : 'Save'}</button></div>
      <div className="bag-weight-summary">
        <div><span>Remaining</span><strong>{Number.isFinite(draft.remainingWeightG) ? draft.remainingWeightG.toFixed(1) : '—'} g</strong></div>
        <div><span>Original bag</span><strong>{Number.isFinite(draft.originalWeightG) ? draft.originalWeightG.toFixed(1) : '—'} g</strong></div>
        <div className="bag-weight-progress" aria-label={`${Math.round(Math.min(100, Math.max(0, draft.remainingWeightG / Math.max(1, draft.originalWeightG) * 100)))}% remaining`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(100, Math.max(0, draft.remainingWeightG / Math.max(1, draft.originalWeightG) * 100)))}><span style={{ width: `${Math.min(100, Math.max(0, draft.remainingWeightG / Math.max(1, draft.originalWeightG) * 100))}%` }} /></div>
      </div>

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

      <div className="bag-section"><div className="bag-section__heading"><span>Taste profile</span><small>Optional</small></div>
        <div className="tasting-note-grid">{[0, 1, 2].map((index) => <label className="recipe-field" key={index}><span>Tasting note {index + 1}</span><input maxLength={40} placeholder={index === 0 ? 'e.g. Berry' : ''} value={draft.tastingNotes[index] ?? ''} onChange={(event) => setDraft((current) => { const notes = [...current.tastingNotes]; notes[index] = event.target.value; return { ...current, tastingNotes: notes } })} /></label>)}</div>
        <div className="bag-rating-grid"><RatingField label="Acidity" value={draft.acidity} onChange={(acidity) => setDraft({ ...draft, acidity })} /><RatingField label="Bitterness" value={draft.bitterness} onChange={(bitterness) => setDraft({ ...draft, bitterness })} /></div>
      </div>

      <div className="bag-section"><div className="bag-section__heading"><span>Origin and processing</span><small>Optional</small></div><div className="bag-form-grid">
        <label className="recipe-field"><span>Altitude</span><div><input min="0" max="5000" step="1" type="number" value={draft.altitudeM ?? ''} onChange={(event) => setDraft({ ...draft, altitudeM: event.target.value ? Number(event.target.value) : undefined })} /><small>m</small></div></label>
        <label className="recipe-field"><span>Origin / location</span><input maxLength={80} value={draft.origin} onChange={(event) => setDraft({ ...draft, origin: event.target.value })} /></label>
        <label className="recipe-field bag-field--wide"><span>Farm</span><input maxLength={80} value={draft.farm} onChange={(event) => setDraft({ ...draft, farm: event.target.value })} /></label>
      </div>
        <fieldset className="processing-field"><legend>Processing · choose up to three</legend><div>{processingOptions.filter((item) => item !== 'Other').map((process) => <button aria-pressed={draft.processing.includes(process)} className={draft.processing.includes(process) ? 'active' : ''} key={process} onClick={() => toggleProcessing(process)} type="button">{process}</button>)}</div><label><span>Other process</span><input maxLength={40} value={customProcess} onChange={(event) => setCustomProcess(event.target.value)} /></label></fieldset>
      </div>
      <p className="library-message" role="status">{message}</p>
    </section>
  </div>
}
