// One CSS cycle for the whole hero: the lost intro once, then each search in turn. Every beat is
// computed here in milliseconds and emitted as @keyframes over the same cycle length, so all
// animations share one clock (the search card's), pause together, and the typing in HeroMap.tsx
// reads the same numbers.
//
// Per search (ms from the search card's entrance, S):
//   S          search card enters (325, ease-out)
//   S+325      typing; a beat after each word
//   H          typing done +65: result row rises, pin drops (+65, pop)
//   H+455      "Go" is pressed
//   H+715      route draws, walker follows (duration scales with length, ease-walk); card leaves at H+780
//   bend       turn card is fully in as the walker reaches the bend; leaves before arrival
//   A          arrival: pin bounces, ring ripples, arrival card enters (+65)
//   A+2000     route, pin and arrival card clear together (300)
//   A+2120     the next search card enters while that clear finishes: one gesture, not a queue
// The gate mark lands once, after the lost intro, and stays until the last search clears.
import type { HeroQuery } from './heroQueries'

const EO = 'cubic-bezier(0.23, 1, 0.32, 1)' // --ease-out
const POP = 'cubic-bezier(0.34, 1.56, 0.64, 1)' // --ease-pop
const WALK = 'cubic-bezier(0.37, 0, 0.63, 1)' // --ease-walk
const WANDER = 'cubic-bezier(.4, 0, .6, 1)'

/** The intro's beats, unchanged from the single-search version (it was 13 s; 1% = 130 ms). */
const INTRO = { gateIn: 4030, gateLanded: 4485, ringAt: 4290, firstSearch: 4550 }
const CARD_IN = 325
const CARD_OUT = 195
const HOLD = 2000
const CLEAR = 300
const NEXT_OVERLAP = 180 // the next card starts this long before the clear ends
const TAIL = 700 // empty map before the lost trails come back
/** Draw speed of the original route (816 u in 3.5 s), clamped so a short walk still reads and a long one doesn't drag. */
const drawMs = (length: number) => Math.round(Math.min(3900, Math.max(2400, length * 4.3)))

/** Keystroke times: an uneven cadence with a beat after each word reads as a person, not a ticker. */
export function keyTimes(text: string) {
  let t = 0
  return [...text].map((ch, i) => (t += ch === ' ' ? 62 : 30 + ((i * 7) % 5) * 5))
}

/** Time fraction at which the walker (cubic-bezier(0.37, 0, 0.63, 1) on offset-distance) reaches progress p. */
function walkTimeAt(p: number) {
  const bx = (s: number) => 3 * (1 - s) ** 2 * s * 0.37 + 3 * (1 - s) * s * s * 0.63 + s ** 3
  const by = (s: number) => 3 * (1 - s) * s * s + s ** 3
  let lo = 0, hi = 1
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (by(m) < p) lo = m; else hi = m }
  return bx((lo + hi) / 2)
}

export type Beat = {
  start: number; typeAt: number; keys: number[]; hitAt: number; goAt: number
  routeAt: number; exitAt: number; arriveAt: number; clearAt: number
  turn?: { inAt: number; outAt: number }
}

export function buildTimeline(queries: HeroQuery[]) {
  const beats: Beat[] = []
  let start = INTRO.firstSearch
  for (const q of queries) {
    const keys = keyTimes(q.query)
    const typeAt = start + CARD_IN
    const hitAt = typeAt + keys[keys.length - 1] + 65
    const routeAt = hitAt + 715
    const arriveAt = routeAt + drawMs(q.length)
    const clearAt = arriveAt + HOLD
    let turn: Beat['turn']
    if (q.turn) {
      const bend = routeAt + Math.round((arriveAt - routeAt) * walkTimeAt(q.turn.at))
      // Hold for 650 ms, but always leave before the arrival card comes in.
      turn = { inAt: bend, outAt: Math.max(bend + 300, Math.min(bend + 650, arriveAt - CARD_OUT - 130)) }
    }
    beats.push({ start, typeAt, keys, hitAt, goAt: hitAt + 455, routeAt, exitAt: hitAt + 780, arriveAt, clearAt, turn })
    start = clearAt + CLEAR - NEXT_OVERLAP
  }
  const lastClear = beats[beats.length - 1].clearAt
  const cycle = lastClear + CLEAR + TAIL
  return { beats, cycle, css: keyframesCss(beats, cycle, lastClear) }
}

type Stop = [ms: number, decl: string, ease?: string]

function kf(name: string, cycle: number, stops: Stop[]) {
  const all = [...stops]
  if (all[0][0] > 0) all.unshift([0, all[0][1]])
  if (all[all.length - 1][0] < cycle) all.push([cycle, all[all.length - 1][1]])
  const body = all
    .map(([ms, decl, ease]) => `${+((ms / cycle) * 100).toFixed(4)}%{${decl}${ease ? `;animation-timing-function:${ease}` : ''}}`)
    .join('')
  return `@keyframes ${name}{${body}}`
}

/** Card states shared by the search, turn and arrival cards. */
const CARD_HIDDEN = 'opacity:0;transform:translateY(10px) scale(0.97)'
const TURN_HIDDEN = 'opacity:0;transform:translateY(8px) scale(0.97)'
const CARD_SHOWN = 'opacity:1;transform:none'
const CARD_GONE = 'opacity:0;transform:translateY(-6px) scale(0.98)'

function keyframesCss(beats: Beat[], L: number, lastClear: number) {
  const css: string[] = []
  const add = (name: string, stops: Stop[]) => css.push(kf(name, L, stops))

  /* ---- intro: lost trails at the gate, then the Kumpas mark lands ---- */
  const trail = (i: number) => {
    const s = 390 + i * 260, e = 2860 + i * 260
    add(`lp-reveal-${i}`, [[s, 'stroke-dashoffset:1', WANDER], [e, 'stroke-dashoffset:0']])
    add(`lp-lost-${i}`, [
      [s - 130, 'opacity:0;offset-distance:0%'], [s, 'opacity:1;offset-distance:0%', WANDER],
      [e, 'opacity:1;offset-distance:100%'], [4030, 'opacity:1;offset-distance:100%'], [4680, 'opacity:0;offset-distance:100%'],
    ])
  }
  ;[0, 1, 2].forEach(trail)
  add('lp-trail', [[260, 'opacity:0'], [520, 'opacity:0.7'], [4030, 'opacity:0.7'], [4810, 'opacity:0']])
  add('lp-q', [[2990, 'opacity:0;transform:scale(0.6)', POP], [3445, 'opacity:1;transform:none'], [4030, 'opacity:1;transform:none', EO], [4420, 'opacity:0;transform:scale(0.8)']])
  add('lp-gate', [
    [INTRO.gateIn, 'opacity:0;transform:scale(0.7) rotate(-8deg)', POP], [INTRO.gateLanded, 'opacity:1;transform:none'],
    [lastClear, 'opacity:1;transform:none', EO], [lastClear + CLEAR, 'opacity:0;transform:scale(0.9)'],
  ])
  add('lp-gate-ring', [[INTRO.ringAt, 'opacity:0;transform:scale(1)'], [INTRO.ringAt + 65, 'opacity:0.9;transform:scale(1)', EO], [INTRO.ringAt + 1430, 'opacity:0;transform:scale(2.4)']])
  add('lp-gate-glow', [[INTRO.gateIn, 'opacity:0', EO], [4550, 'opacity:1', 'ease'], [6500, 'opacity:0.6'], [lastClear, 'opacity:0.6', EO], [lastClear + CLEAR, 'opacity:0']])

  /* ---- the search card: one element, in and out once per search (it is also the clock) ---- */
  const search: Stop[] = []
  const go: Stop[] = []
  beats.forEach(b => {
    search.push([b.start, CARD_HIDDEN, EO], [b.start + CARD_IN, CARD_SHOWN], [b.exitAt, CARD_SHOWN, EO], [b.exitAt + CARD_OUT, CARD_GONE], [b.exitAt + CARD_OUT + 5, CARD_HIDDEN])
    go.push([b.goAt, 'transform:none', EO], [b.goAt + 104, 'transform:scale(0.95)', EO], [b.goAt + 286, 'transform:none'])
  })
  add('lp-search', search)
  add('lp-search-go', go)

  /* ---- per search: result row, route, walker, pin, turn and arrival cards ---- */
  beats.forEach((b, i) => {
    const out = b.exitAt + CARD_OUT
    add(`lp-hit-${i}`, [[b.hitAt, 'opacity:0;transform:translateY(6px)', EO], [b.hitAt + 260, 'opacity:1;transform:none'], [out, 'opacity:1;transform:none'], [out + 5, 'opacity:0;transform:translateY(6px)']])
    add(`lp-route-${i}`, [
      [b.routeAt, 'stroke-dashoffset:1;opacity:1', WALK], [b.arriveAt, 'stroke-dashoffset:0;opacity:1'],
      [b.clearAt, 'stroke-dashoffset:0;opacity:1', EO], [b.clearAt + CLEAR, 'stroke-dashoffset:0;opacity:0'], [b.clearAt + CLEAR + 5, 'stroke-dashoffset:1;opacity:0'],
    ])
    add(`lp-walk-${i}`, [
      [b.routeAt - 65, 'opacity:0;offset-distance:0%'], [b.routeAt, 'opacity:1;offset-distance:0%', WALK],
      [b.arriveAt, 'opacity:1;offset-distance:100%', EO], [b.arriveAt + 260, 'opacity:0;offset-distance:100%'], [b.arriveAt + 265, 'opacity:0;offset-distance:0%'],
    ])
    const pinAt = b.hitAt + 65
    add(`lp-dest-${i}`, [
      [pinAt, 'opacity:0;transform:translateY(-18px) scale(0.9)', POP], [pinAt + 390, 'opacity:1;transform:none'],
      [b.arriveAt, 'opacity:1;transform:none', EO], [b.arriveAt + 169, 'opacity:1;transform:scale(1.3)', POP], [b.arriveAt + 520, 'opacity:1;transform:none'],
      [b.clearAt, 'opacity:1;transform:none', EO], [b.clearAt + CLEAR, 'opacity:0;transform:scale(0.8)'], [b.clearAt + CLEAR + 5, 'opacity:0;transform:translateY(-18px) scale(0.9)'],
    ])
    add(`lp-dest-ring-${i}`, [[b.arriveAt, 'opacity:0;transform:scale(0.6)'], [b.arriveAt + 65, 'opacity:1;transform:scale(0.6)', EO], [b.arriveAt + 1430, 'opacity:0;transform:scale(2.2)']])
    if (b.turn) {
      add(`lp-turn-${i}`, [[b.turn.inAt - CARD_IN, TURN_HIDDEN, EO], [b.turn.inAt, CARD_SHOWN], [b.turn.outAt, CARD_SHOWN, EO], [b.turn.outAt + CARD_OUT, CARD_GONE], [b.turn.outAt + CARD_OUT + 5, TURN_HIDDEN]])
    }
    add(`lp-arrive-${i}`, [[b.arriveAt + 65, CARD_HIDDEN, EO], [b.arriveAt + 390, CARD_SHOWN], [b.clearAt, CARD_SHOWN, EO], [b.clearAt + CLEAR, CARD_GONE], [b.clearAt + CLEAR + 5, CARD_HIDDEN]])
  })
  return css.join('\n')
}
