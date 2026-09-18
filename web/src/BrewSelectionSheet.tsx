import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BeakerIcon as Coffee, CheckCircleIcon as CheckCircle2, XMarkIcon as X } from '@heroicons/react/24/solid'
import { createPortal } from 'react-dom'
import { expectedRecipeYield, formatRecipeWeight, formatTime } from './brew'
import { isDepletedCoffeeBag } from './coffeeBag'
import type { BrewRecipe, CoffeeBag } from './brewTypes'
import { Button } from './ui'

interface BrewSelectionSheetProps {
  dark: boolean
  recipes: BrewRecipe[]
  coffeeBags: CoffeeBag[]
  selectedRecipeId: string
  selectedCoffeeBagId: string | null
  onClose: () => void
  onConfirm: (recipeId: string, coffeeBagId: string | null) => void
}

function SelectionCard({ selected, children, disabled = false, label, onClick }: { selected: boolean; children: ReactNode; disabled?: boolean; label: string; onClick: () => void }) {
  return <button aria-checked={selected} aria-disabled={disabled || undefined} aria-label={label} className={selected ? 'brew-selection-card is-selected' : 'brew-selection-card'} disabled={disabled} onClick={onClick} role="radio" type="button">{children}{selected ? <CheckCircle2 aria-hidden="true" className="brew-selection-card__check" /> : null}</button>
}

export function BrewSelectionSheet({ dark, recipes, coffeeBags, selectedRecipeId, selectedCoffeeBagId, onClose, onConfirm }: BrewSelectionSheetProps) {
  const [draftRecipeId, setDraftRecipeId] = useState(selectedRecipeId)
  const initialCoffeeBag = selectedCoffeeBagId ? coffeeBags.find((bag) => bag.id === selectedCoffeeBagId) : null
  const [draftCoffeeBagId, setDraftCoffeeBagId] = useState<string | null>(initialCoffeeBag && !isDepletedCoffeeBag(initialCoffeeBag) ? initialCoffeeBag.id : null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const orderedCoffeeBags = [...coffeeBags].sort((left, right) => Number(isDepletedCoffeeBag(left)) - Number(isDepletedCoffeeBag(right)))
  const selectedRecipe = recipes.find((recipe) => recipe.id === draftRecipeId) ?? recipes[0] ?? null

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    const appliance = document.querySelector<HTMLElement>('.appliance')
    const previousInert = appliance?.hasAttribute('inert') ?? false
    const previousAriaHidden = appliance?.getAttribute('aria-hidden')
    document.body.style.overflow = 'hidden'
    appliance?.setAttribute('inert', '')
    appliance?.setAttribute('aria-hidden', 'true')
    requestAnimationFrame(() => overlayRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return }
      if (event.key !== 'Tab') return
      const scope = overlayRef.current
      if (!scope) return
      const focusable = Array.from(scope.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')).filter((element) => element.getClientRects().length > 0)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      if (appliance) {
        if (!previousInert) appliance.removeAttribute('inert')
        if (previousAriaHidden == null) appliance.removeAttribute('aria-hidden')
        else appliance.setAttribute('aria-hidden', previousAriaHidden)
      }
      window.removeEventListener('keydown', onKeyDown)
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus()
    }
  }, [])

  return createPortal(
    <div className={dark ? 'brew-selection-toast-container brew-selection-toast-container--dark' : 'brew-selection-toast-container'} ref={overlayRef}>
      <section aria-labelledby="brew-selection-title" aria-modal="true" className="brew-selection-toast" role="dialog">
        <header className="brew-selection-toast__header">
          <div>
            <span className="brew-selection-toast__step">Brew setup</span>
            <h2 className="modal-title modal-title--selection" id="brew-selection-title">Choose your brew</h2>
            <p>Pick your coffee and recipe for this brew.</p>
          </div>
          <button aria-label="Close brew selection" className="brew-selection-close" onClick={onClose} type="button"><X aria-hidden="true" /><span>Close</span></button>
        </header>

        <div className="brew-selection-toast__body">
          <section aria-labelledby="brew-selection-coffee-heading" className="brew-selection-section">
            <div className="brew-selection-section__heading"><div><span>01</span><h3 className="section-title section-title--selection" id="brew-selection-coffee-heading">Coffee beans</h3></div><small>Swipe or use Tab to browse</small></div>
            <div aria-labelledby="brew-selection-coffee-heading" className="brew-selection-rail" role="radiogroup">
              <SelectionCard label="Brew without a coffee bag" selected={draftCoffeeBagId === null} onClick={() => setDraftCoffeeBagId(null)}><div className="brew-selection-card__icon"><Coffee aria-hidden="true" /></div><strong>No coffee bag</strong><span>Skip inventory tracking</span><small>Choose this if the beans are not in the shared library.</small></SelectionCard>
              {orderedCoffeeBags.map((bag) => {
                const depleted = isDepletedCoffeeBag(bag)
                return <SelectionCard disabled={depleted} key={bag.id} label={`${bag.name}${depleted ? ', depleted' : ''}`} selected={draftCoffeeBagId === bag.id} onClick={() => setDraftCoffeeBagId(bag.id)}>
                  <div className="brew-selection-card__icon"><Coffee aria-hidden="true" /></div>
                  <strong>{bag.name}</strong>
                  <span>{bag.roastery} · {bag.roastLevel}</span>
                  <b>{bag.remainingWeightG.toFixed(1)} g remaining</b>
                  <small>{bag.origin || 'Origin not recorded'}{depleted ? ' · Depleted' : ''}</small>
                </SelectionCard>
              })}
            </div>
          </section>
          <section aria-labelledby="brew-selection-recipe-heading" className="brew-selection-section">
            <div className="brew-selection-section__heading"><div><span>02</span><h3 className="section-title section-title--selection" id="brew-selection-recipe-heading">Brew recipes</h3></div><small>Swipe or use Tab to browse</small></div>
            <div aria-labelledby="brew-selection-recipe-heading" className="brew-selection-rail" role="radiogroup">
              {recipes.map((recipe) => <SelectionCard key={recipe.id} label={`Select ${recipe.name}`} selected={draftRecipeId === recipe.id} onClick={() => setDraftRecipeId(recipe.id)}>
                <div className="brew-selection-card__topline"><span>{recipe.serveStyle === 'iced' ? 'Iced brew' : 'Hot brew'}</span><span>{recipe.dripper}</span></div>
                <strong>{recipe.name}</strong>
                <b>{formatRecipeWeight(recipe.coffee)} g coffee · {formatRecipeWeight(recipe.water)} g water</b>
                <small>{formatRecipeWeight(expectedRecipeYield(recipe))} g expected yield · {formatTime(recipe.brewTime)}</small>
              </SelectionCard>)}
            </div>
          </section>
        </div>

        <footer className="brew-selection-toast__footer">
          {selectedRecipe ? <p className="brew-selection-toast__summary"><strong>{selectedRecipe.name}</strong><span>{formatRecipeWeight(selectedRecipe.coffee)} g coffee · {formatTime(selectedRecipe.brewTime)}</span></p> : null}
          <div className="brew-selection-toast__footer-row">
            <span className="brew-selection-toast__footer-note">Your choices are applied when you prepare the brew.</span>
            <Button disabled={!selectedRecipe} onClick={() => selectedRecipe && onConfirm(selectedRecipe.id, draftCoffeeBagId)} type="button">Prepare brew<Coffee aria-hidden="true" /></Button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
