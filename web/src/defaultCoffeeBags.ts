import type { CoffeeBag } from './brewTypes'

/** Starter inventory for a brand-new PourFrame library. */
export const defaultCoffeeBags: CoffeeBag[] = [
  {
    id: 'coffee-ethiopia-buku', name: 'Ethiopia Buku', roastery: 'Daybreak Coffee', roastedOn: '2026-07-29', roastLevel: 'Light', beanForm: 'Whole bean',
    tastingNotes: ['Blueberry', 'Bergamot', 'Cane sugar'], acidity: 4, bitterness: 1, originalWeightG: 250, remainingWeightG: 182,
    altitudeM: 2100, origin: 'Guji, Ethiopia', farm: 'Buku Abel', processing: ['Natural / dried'], createdAt: '2026-07-29T09:00:00.000Z', updatedAt: '2026-07-29T09:00:00.000Z', starred: true,
  },
  {
    id: 'coffee-colombia-el-paraiso', name: 'Colombia El Paraíso', roastery: 'Daybreak Coffee', roastedOn: '2026-07-15', roastLevel: 'Medium-light', beanForm: 'Whole bean',
    tastingNotes: ['Peach', 'Cocoa', 'Caramel'], acidity: 3, bitterness: 2, originalWeightG: 250, remainingWeightG: 0,
    altitudeM: 1850, origin: 'Cauca, Colombia', farm: 'El Paraíso', processing: ['Washed'], createdAt: '2026-07-15T09:00:00.000Z', updatedAt: '2026-07-31T09:00:00.000Z', starred: true,
  },
  {
    id: 'coffee-kenya-kirinyaga', name: 'Kenya Kirinyaga', roastery: 'Northline Roasters', roastedOn: '2026-08-01', roastLevel: 'Light', beanForm: 'Whole bean',
    tastingNotes: ['Blackcurrant', 'Grapefruit', 'Tomato leaf'], acidity: 4, bitterness: 1, originalWeightG: 200, remainingWeightG: 200,
    altitudeM: 1700, origin: 'Kirinyaga, Kenya', farm: 'Kiamugumo', processing: ['Washed'], createdAt: '2026-08-01T09:00:00.000Z', updatedAt: '2026-08-01T09:00:00.000Z', starred: false,
  },
]
