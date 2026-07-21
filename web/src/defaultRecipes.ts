import type { BrewRecipe } from './brewTypes'

export const defaultRecipes: BrewRecipe[] = [
  { id: 'recipe-v60-balanced', name: 'Balanced V60', dripper: 'V60 02', coffee: 20, water: 320, ratio: 16, grind: 'Medium-fine', bloom: 60, poursAfterBloom: 4, brewTime: 180, flowRate: 4.5, temperature: 94, agitation: 'Gentle swirl after bloom', equipment: ['V60 02', 'Paper filter', 'Gooseneck kettle'], notes: 'A clear, balanced everyday recipe.' },
  { id: 'recipe-v60-light', name: 'Light roast clarity', dripper: 'V60 02', coffee: 15, water: 255, ratio: 17, grind: 'Medium-fine', bloom: 45, poursAfterBloom: 3, brewTime: 165, flowRate: 4, temperature: 96, agitation: 'Single bloom swirl', equipment: ['V60 02', 'Paper filter', 'Gooseneck kettle'], notes: 'Higher ratio and temperature for clarity.' },
  { id: 'recipe-kalita', name: 'Kalita comfort', dripper: 'Kalita 185', coffee: 22, water: 330, ratio: 15, grind: 'Medium', bloom: 65, poursAfterBloom: 4, brewTime: 190, flowRate: 4.2, temperature: 93, agitation: 'None', equipment: ['Kalita 185', 'Wave filter', 'Gooseneck kettle'], notes: 'Round and sweet with even pulses.' },
]
