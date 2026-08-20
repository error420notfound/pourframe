import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpenIcon as BookOpen, BookmarkSquareIcon as Save, XMarkIcon as X } from '@heroicons/react/24/solid'
import { catalogClient, catalogRecipeId, catalogRecipeToBrewRecipe, CATALOG_REPOSITORY_URL, filterCatalogRecipes, isNewCatalogRecipe, type CatalogRecipe, type CatalogRecipeSummary } from './catalog'
import { expectedRecipeYield, formatRecipeWeight, formatTime } from './brew'
import type { BrewRecipe } from './brewTypes'
import { EmptyState, LibraryPanel, SectionHeader } from './ui'

type CatalogState = 'loading' | 'ready' | 'cached' | 'offline' | 'error'

export function CatalogRecipes({ recipes, onSave }: { recipes: BrewRecipe[]; onSave: (recipe: BrewRecipe) => Promise<void> }) {
  const [catalogRecipes, setCatalogRecipes] = useState<CatalogRecipeSummary[]>([])
  const [state, setState] = useState<CatalogState>('loading')
  const [message, setMessage] = useState('Loading catalog recipes…')
  const [query, setQuery] = useState('')
  const [dripper, setDripper] = useState('')
  const [serveStyle, setServeStyle] = useState('')
  const [selected, setSelected] = useState<CatalogRecipeSummary | null>(null)
  const [detail, setDetail] = useState<CatalogRecipe | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const indexAbort = useRef<AbortController | null>(null)
  const detailAbort = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController(); indexAbort.current = controller
    const load = async () => {
      try {
        const result = await catalogClient.recipes(controller.signal)
        if (controller.signal.aborted) return
        setCatalogRecipes(result.data.recipes); setState(result.source === 'cached' ? 'cached' : 'ready')
        setMessage(result.source === 'cached' ? 'Showing cached catalog recipes while checking for updates.' : '')
        void result.refresh?.then((fresh) => {
          if (!controller.signal.aborted) { setCatalogRecipes(fresh.data.recipes); setState('ready'); setMessage('') }
        }).catch(() => { if (!controller.signal.aborted) { setState('offline'); setMessage('Showing saved catalog recipes while offline.') } })
      } catch {
        if (!controller.signal.aborted) { setState('error'); setMessage('Catalog recipes are unavailable. Your saved recipes are still available.') }
      }
    }
    void load()
    return () => controller.abort()
  }, [])

  const drippers = useMemo(() => [...new Set(catalogRecipes.map((recipe) => recipe.dripper))].sort((left, right) => left.localeCompare(right)), [catalogRecipes])
  const visible = useMemo(() => filterCatalogRecipes(catalogRecipes, query, dripper, serveStyle), [catalogRecipes, dripper, query, serveStyle])
  const open = (recipe: CatalogRecipeSummary) => {
    detailAbort.current?.abort(); setSelected(recipe); setDetail(null); setDetailLoading(true); setMessage('')
    const controller = new AbortController(); detailAbort.current = controller
    void catalogClient.recipe(recipe.path, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (result.data.id !== recipe.id) throw new Error('This catalog recipe is invalid.')
      setDetail(result.data); setDetailLoading(false)
      void result.refresh?.then((fresh) => { if (!controller.signal.aborted && fresh.data.id === recipe.id) setDetail(fresh.data) }).catch(() => { if (!controller.signal.aborted) setMessage('Showing saved catalog recipe details while offline.') })
    }).catch(() => { if (!controller.signal.aborted) { setDetailLoading(false); setMessage('This catalog recipe could not be loaded.') } })
  }
  const close = () => { detailAbort.current?.abort(); setSelected(null); setDetail(null); setDetailLoading(false) }
  const save = async () => {
    if (!detail) return
    try {
      setSaving(true)
      const local = catalogRecipeToBrewRecipe(detail)
      await onSave(local)
      setMessage(recipes.some((recipe) => recipe.id === catalogRecipeId(detail.id)) ? 'Saved recipe updated on PourFrame.' : 'Catalog recipe added to your saved recipes.')
      close()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'This catalog recipe could not be saved.') } finally { setSaving(false) }
  }
  const saved = detail ? recipes.some((recipe) => recipe.id === catalogRecipeId(detail.id)) : false
  return <section className="library-group catalog-recipes" aria-labelledby="catalog-recipes-title">
    <SectionHeader count={catalogRecipes.length} title="Catalog recipes" variant="compact" />
    <p className="catalog-recipes__description" id="catalog-recipes-title">Discover recipes from the <a href={CATALOG_REPOSITORY_URL} rel="noreferrer" target="_blank">PourFrame Catalog</a>. They are not added to your saved recipes until you choose to add one.</p>
    <div className="library-controls catalog-recipes__controls"><label><span>Search</span><input onChange={(event) => setQuery(event.target.value)} placeholder="Name or dripper" type="search" value={query} /></label><label><span>Dripper</span><select onChange={(event) => setDripper(event.target.value)} value={dripper}><option value="">All drippers</option>{drippers.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label><span>Serve</span><select onChange={(event) => setServeStyle(event.target.value)} value={serveStyle}><option value="">All styles</option><option value="hot">Hot brew</option><option value="iced">Iced brew</option></select></label></div>
    {state === 'loading' ? <p className="library-message" role="status">Loading catalog recipes…</p> : null}
    {state !== 'loading' && !visible.length && state !== 'error' ? <EmptyState description="Try a different search or filter." icon={<BookOpen aria-hidden="true" />} title="No matching catalog recipes" /> : null}
    {visible.length ? <div className="recipe-collection catalog-recipes__collection">{visible.map((recipe) => <article className="library-card recipe-card catalog-recipe-card" key={recipe.id}><button className="library-card__open recipe-card__open" onClick={() => open(recipe)} type="button"><strong className="card-title">{recipe.name}{isNewCatalogRecipe(recipe) ? <span className="catalog-new">New</span> : null}</strong><span>{recipe.serveStyle === 'iced' ? 'Iced brew' : 'Hot brew'} · {recipe.dripper}</span><small>From PourFrame Catalog</small></button></article>)}</div> : null}
    <p className="library-message" role="status">{message}</p>
    {selected ? <LibraryPanel
      actions={<>{detail ? <><button aria-label={saving ? 'Saving catalog recipe' : saved ? 'Update saved recipe' : 'Add to my recipes'} className="library-panel-action library-panel-action--primary" data-tooltip={saving ? 'Saving…' : saved ? 'Update saved recipe' : 'Add to my recipes'} disabled={saving} onClick={() => void save()} type="button"><Save aria-hidden="true" /></button><span aria-hidden="true" className="library-panel__separator" /></> : null}<button aria-label="Close catalog recipe" className="library-panel-action" data-tooltip="Close" onClick={close} type="button"><X aria-hidden="true" /></button></>}
      onEscape={close}
      title={selected.name}
    >
      {detailLoading ? <p className="library-message" role="status">Loading catalog recipe…</p> : null}{detail ? <dl className="library-detail"><div><dt>Serving</dt><dd>{detail.serveStyle === 'iced' ? 'Iced brew' : 'Hot brew'}</dd></div><div><dt>Brewer</dt><dd>{detail.dripper}</dd></div><div><dt>Coffee dose</dt><dd>{formatRecipeWeight(detail.coffee)} g</dd></div><div><dt>Expected yield</dt><dd>{formatRecipeWeight(expectedRecipeYield(detail))} g</dd></div><div><dt>Brew time</dt><dd>{formatTime(detail.brewTime)}</dd></div><div><dt>Temperature</dt><dd>{formatRecipeWeight(detail.temperature)} °C</dd></div><div><dt>Notes</dt><dd>{detail.notes || 'No notes'}</dd></div></dl> : null}
    </LibraryPanel> : null}
  </section>
}
