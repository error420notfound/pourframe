import { useState, type ReactNode } from 'react'
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
  return <button aria-disabled={disabled || undefined} aria-label={label} aria-pressed={selected} className={selected ? 'brew-selection-card is-selected' : 'brew-selection-card'} disabled={disabled} onClick={onClick} type="button">{children}{selected ? <CheckCircle2 aria-hidden="true" className="brew-selection-card__check" /> : null}</button>
}

export function BrewSelectionSheet({ dark, recipes, coffeeBags, selectedRecipeId, selectedCoffeeBagId, onClose, onConfirm }: BrewSelectionSheetProps) {
  const [draftRecipeId, setDraftRecipeId] = useState(selectedRecipeId)
  const initialCoffeeBag = selectedCoffeeBagId ? coffeeBags.find((bag) => bag.id === selectedCoffeeBagId) : null
  const [draftCoffeeBagId, setDraftCoffeeBagId] = useState<string | null>(initialCoffeeBag && !isDepletedCoffeeBag(initialCoffeeBag) ? initialCoffeeBag.id : null)
  const orderedCoffeeBags = [...coffeeBags].sort((left, right) => Number(isDepletedCoffeeBag(left)) - Number(isDepletedCoffeeBag(right)))
  const selectedRecipe = recipes.find((recipe) => recipe.id === draftRecipeId) ?? recipes[0] ?? null

  return createPortal(
    <div className={dark ? 'brew-selection-toast-container brew-selection-toast-container--dark' : 'brew-selection-toast-container'}>
      <section aria-labelledby="brew-selection-title" className="brew-selection-toast" role="region">
        <header className="brew-selection-toast__header">
          <div>
            <span className="brew-selection-toast__step">Brew setup</span>
            <h2 className="modal-title modal-title--selection" id="brew-selection-title">Choose your brew</h2>
            <p>Pick your coffee and recipe for this brew.</p>
          </div>
          <button aria-label="Close brew selection" className="icon-button" onClick={onClose} type="button"><X aria-hidden="true" /></button>
        </header>

        <div className="brew-selection-toast__body">
          <section aria-labelledby="brew-selection-coffee-heading" className="brew-selection-section">
            <div className="brew-selection-section__heading"><div><span>01</span><h3 className="section-title section-title--selection" id="brew-selection-coffee-heading">Coffee beans</h3></div><small>Swipe to browse</small></div>
            <div aria-label="Coffee beans" className="brew-selection-rail">
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
            <div className="brew-selection-section__heading"><div><span>02</span><h3 className="section-title section-title--selection" id="brew-selection-recipe-heading">Brew recipes</h3></div><small>Swipe to browse</small></div>
            <div aria-label="Brew recipes" className="brew-selection-rail">
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
