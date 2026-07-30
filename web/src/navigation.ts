export type AppTab = 'brew' | 'recipes' | 'history' | 'device'
export type RecipeLibraryView = 'coffee' | 'recipes'

export interface AppNavigation {
  tab: AppTab
  recipeLibraryView: RecipeLibraryView
}

const recipeHashes: Record<RecipeLibraryView, string> = {
  coffee: '#recipes/coffee-bags',
  recipes: '#recipes/brew-recipes',
}

export function appHash(tab: AppTab, recipeLibraryView: RecipeLibraryView = 'coffee') {
  return tab === 'recipes' ? recipeHashes[recipeLibraryView] : `#${tab}`
}

export function parseAppHash(hash: string, fallbackRecipeView: RecipeLibraryView = 'coffee'): AppNavigation {
  switch (hash.replace(/^#/, '').replace(/\/+$/, '')) {
    case 'recipes':
      return { tab: 'recipes', recipeLibraryView: fallbackRecipeView }
    case 'recipes/coffee-bags':
      return { tab: 'recipes', recipeLibraryView: 'coffee' }
    case 'recipes/brew-recipes':
      return { tab: 'recipes', recipeLibraryView: 'recipes' }
    case 'history':
      return { tab: 'history', recipeLibraryView: fallbackRecipeView }
    case 'device':
      return { tab: 'device', recipeLibraryView: fallbackRecipeView }
    case 'brew':
    case '':
    default:
      return { tab: 'brew', recipeLibraryView: fallbackRecipeView }
  }
}
