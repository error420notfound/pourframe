export type AppTab = 'brew' | 'beans' | 'recipes' | 'history' | 'device'
export type RecipeLibraryView = 'coffee' | 'recipes'

export interface AppNavigation {
  tab: AppTab
  recipeLibraryView: RecipeLibraryView
}

export function appHash(tab: AppTab, recipeLibraryView: RecipeLibraryView = 'coffee') {
  void recipeLibraryView
  return `#${tab}`
}

export function parseAppHash(hash: string, fallbackRecipeView: RecipeLibraryView = 'coffee'): AppNavigation {
  switch (hash.replace(/^#/, '').replace(/\/+$/, '')) {
    case 'recipes':
    case 'recipes/brew-recipes':
      return { tab: 'recipes', recipeLibraryView: 'recipes' }
    case 'beans':
    case 'recipes/coffee-bags':
      return { tab: 'beans', recipeLibraryView: 'coffee' }
    case 'history':
      return { tab: 'history', recipeLibraryView: fallbackRecipeView }
    case 'device':
      return { tab: 'device', recipeLibraryView: fallbackRecipeView }
    case 'brew':
      return { tab: 'brew', recipeLibraryView: fallbackRecipeView }
    case '':
    default:
      return { tab: 'history', recipeLibraryView: fallbackRecipeView }
  }
}
