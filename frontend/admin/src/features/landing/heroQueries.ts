// The searches the hero cycles through. Every query was run on the real app; names, buildings
// and floors are the live data. Routes are the app's own shortest walking path over the pathways
// campus admins drew in the Map Editor (campusPathways.ts), from the Gate node to the building's
// entrance node; the pin sits on that entrance. Minutes are the haversine length at 80 m/min, matching the app.
import { adminRoute, ccsictRoute, type GraphRoute } from './campusPathways'

export type Pt = { x: number; y: number }
/** Desktop placement of a card: 'above' hangs its bottom-right corner on the anchor, 'below' its top-right. */
export type Anchor = Pt & { side: 'above' | 'below' }

export type HeroTurn = {
  /** Fraction of the route length where the card should be fully in: the junction the walker turns at. */
  at: number
  dir: 'left' | 'right'
  title: string
  sub: string
  anchor: Anchor
}

export type HeroQuery = {
  query: string
  name: string
  building: string
  floor: string
  minutes: number
  /** SVG path in map units, starting at the Gate node. */
  route: string
  /** Route length in map units; drives the draw duration. */
  length: number
  dest: Pt
  turn?: HeroTurn
  arrive: Anchor
}

const minutes = (r: GraphRoute) => Math.round(r.metres / 80)

/* Shared by both Admin searches: Gate, entrance lane, right at Junction Gate (node 8), left at
   the next junction (node 2, 35 m on) onto the one-way loop up to the Admin Entrance (node 6). */
const toAdmin = {
  building: 'Administration Building',
  minutes: minutes(adminRoute), // 500 m
  route: adminRoute.d,
  length: adminRoute.length,
  dest: adminRoute.end,
  turn: {
    at: adminRoute.at['8'], dir: 'right', title: 'Turn right, then left', sub: 'Around to the Admin Entrance',
    anchor: { x: 655, y: 858, side: 'below' },
  },
  arrive: { x: 735, y: 898, side: 'below' },
} satisfies Partial<HeroQuery>

export const HERO_QUERIES: HeroQuery[] = [
  { query: 'where do i enroll', name: 'Office of the Registrar', floor: 'Ground Floor', ...toAdmin },
  {
    query: 'ccsict faculty',
    name: 'Faculty Office',
    building: 'CCSICT',
    floor: '1st Floor',
    minutes: minutes(ccsictRoute), // 649 m
    route: ccsictRoute.d,
    length: ccsictRoute.length,
    dest: ccsictRoute.end,
    // Right at Junction Gate (node 8), then straight down the main road. The last right, at
    // Junction T (node 15), is 14 m from the door: too close to arrival for its own card.
    turn: {
      at: ccsictRoute.at['8'], dir: 'right', title: 'Turn right', sub: 'Past the Administration Building',
      anchor: { x: 655, y: 858, side: 'below' },
    },
    arrive: { x: 600, y: 1100, side: 'above' },
  },
  { query: 'where do i pay', name: 'Cashiering Office', floor: 'Ground Floor', ...toAdmin },
]
