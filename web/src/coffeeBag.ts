import { createId } from './brew'
import type { BeanForm, CoffeeBag, CoffeeBagSnapshot, GrindSize, RoastLevel } from './brewTypes'

export const roastLevels: RoastLevel[] = ['Light', 'Medium-light', 'Medium', 'Medium-dark', 'Dark']
export const beanForms: BeanForm[] = ['Whole bean', 'Pre-ground']
export const grindSizes: GrindSize[] = ['Fine', 'Medium-fine', 'Medium', 'Medium-coarse', 'Coarse']
export const processingOptions = ['Washed', 'Natural / dried', 'Honey', 'Sun-dried', 'Fermented', 'Other'] as const

export type CoffeeBagFilter = 'active' | 'depleted' | 'all'
export type CoffeeBagSort = 'roast-oldest' | 'roast-newest' | 'remaining-low' | 'remaining-high' | 'roastery' | 'name' | 'updated'

export interface CoffeeBagValidation {
  valid: boolean
  errors: Partial<Record<'name' | 'roastery' | 'roastedOn' | 'roastLevel' | 'beanForm' | 'grind' | 'originalWeightG' | 'remainingWeightG' | 'tastingNotes' | 'ratings' | 'altitudeM' | 'processing', string>>
}

function localDate() {
  const date = new Date()
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

export function createCoffeeBag(): CoffeeBag {
  const now = new Date().toISOString()
  return {
    id: createId('coffee'),
    name: 'New coffee',
    roastery: '',
    roastedOn: localDate(),
    roastLevel: 'Medium',
    beanForm: 'Whole bean',
    tastingNotes: ['', '', ''],
    originalWeightG: 250,
    remainingWeightG: 250,
    origin: '',
    farm: '',
    processing: [],
    createdAt: now,
    updatedAt: now,
    starred: false,
  }
}

const trimmed = (value: string, maximum: number) => value.trim().slice(0, maximum)

export function normalizeCoffeeBag(input: CoffeeBag): CoffeeBag {
  const tastingNotes = input.tastingNotes.slice(0, 3).map((item) => trimmed(item, 40))
  while (tastingNotes.length < 3) tastingNotes.push('')
  return {
    ...input,
    name: trimmed(input.name, 80),
    roastery: trimmed(input.roastery, 80),
    grind: input.beanForm === 'Pre-ground' ? input.grind : undefined,
    tastingNotes,
    origin: trimmed(input.origin, 80),
    farm: trimmed(input.farm, 80),
    processing: input.processing.slice(0, 3).map((item) => trimmed(item, 40)).filter(Boolean),
    updatedAt: new Date().toISOString(),
    starred: input.starred === true,
  }
}

const ratingValid = (value: number | undefined) => value === undefined || (Number.isInteger(value) && value >= 1 && value <= 4)

export function validateCoffeeBag(input: CoffeeBag): CoffeeBagValidation {
  const bag = normalizeCoffeeBag(input)
  const errors: CoffeeBagValidation['errors'] = {}
  if (!bag.name) errors.name = 'Coffee name is required.'
  if (!bag.roastery) errors.roastery = 'Roastery is required.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bag.roastedOn) || Number.isNaN(Date.parse(`${bag.roastedOn}T00:00:00Z`))) errors.roastedOn = 'Enter a valid roast date.'
  if (!roastLevels.includes(bag.roastLevel)) errors.roastLevel = 'Choose a supported roast level.'
  if (!beanForms.includes(bag.beanForm)) errors.beanForm = 'Choose whole bean or pre-ground.'
  if (bag.beanForm === 'Pre-ground' && (!bag.grind || !grindSizes.includes(bag.grind))) errors.grind = 'Choose the grind size for pre-ground coffee.'
  if (!Number.isFinite(bag.originalWeightG) || bag.originalWeightG <= 0 || bag.originalWeightG > 5000) errors.originalWeightG = 'Original bag weight must be greater than 0 g and no more than 5000 g.'
  if (!Number.isFinite(bag.remainingWeightG) || bag.remainingWeightG < 0 || bag.remainingWeightG > bag.originalWeightG) errors.remainingWeightG = 'Remaining weight must be from 0 g to the original bag weight.'
  if (bag.tastingNotes.some((item) => item.length > 40)) errors.tastingNotes = 'Each tasting note must be 40 characters or fewer.'
  if (!ratingValid(bag.acidity) || !ratingValid(bag.bitterness)) errors.ratings = 'Acidity and bitterness must be from 1 to 4.'
  if (bag.altitudeM !== undefined && (!Number.isFinite(bag.altitudeM) || bag.altitudeM < 0 || bag.altitudeM > 5000)) errors.altitudeM = 'Altitude must be from 0 to 5000 m.'
  if (bag.processing.length > 3 || bag.processing.some((item) => !item || item.length > 40)) errors.processing = 'Choose up to three processing details.'
  return { valid: Object.keys(errors).length === 0, errors }
}

export function snapshotCoffeeBag(input: CoffeeBag): CoffeeBagSnapshot {
  const { remainingWeightG: _remaining, createdAt: _created, updatedAt: _updated, ...snapshot } = normalizeCoffeeBag(input)
  return snapshot
}

export function isDepletedCoffeeBag(bag: CoffeeBag) {
  return bag.remainingWeightG <= 0
}

export function filterCoffeeBags(bags: CoffeeBag[], filter: CoffeeBagFilter) {
  if (filter === 'all') return bags
  return bags.filter((bag) => filter === 'depleted' ? isDepletedCoffeeBag(bag) : !isDepletedCoffeeBag(bag))
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: 'base' })
}

export function sortCoffeeBags(bags: CoffeeBag[], sort: CoffeeBagSort) {
  return [...bags].sort((left, right) => {
    const activeOrder = Number(isDepletedCoffeeBag(left)) - Number(isDepletedCoffeeBag(right))
    if (activeOrder !== 0) return activeOrder
    if (sort === 'roast-oldest') return left.roastedOn.localeCompare(right.roastedOn) || compareText(left.name, right.name)
    if (sort === 'roast-newest') return right.roastedOn.localeCompare(left.roastedOn) || compareText(left.name, right.name)
    if (sort === 'remaining-low') return left.remainingWeightG - right.remainingWeightG || compareText(left.name, right.name)
    if (sort === 'remaining-high') return right.remainingWeightG - left.remainingWeightG || compareText(left.name, right.name)
    if (sort === 'roastery') return compareText(left.roastery, right.roastery) || compareText(left.name, right.name)
    if (sort === 'updated') return right.updatedAt.localeCompare(left.updatedAt) || compareText(left.name, right.name)
    return compareText(left.name, right.name)
  })
}
