// The hero scene: the real ISU Echague campus (OpenStreetMap footprints), a few
// wandering "lost" traces at the main gate, the Kumpas mark as the turning point,
// then a run of real searches, each routed from the Gate node over the admin-drawn walking pathways.
// One CSS cycle (heroTimeline.ts); only transform, opacity, stroke-dashoffset and
// offset-distance are animated.
//
// Performance: the map is split into two SVGs. The base (buildings, roads, labels) never
// changes and sits on its own compositor layer, so it is rasterised once. Everything that
// animates lives in the thin overlay SVG, so a route-draw frame repaints a few paths, not
// the whole campus.
import { useEffect, useRef, type CSSProperties } from 'react'
import logo from './assets/kumpas-logo.webp'
import { MAP_H, MAP_W, buildingsPath, collegesPath, greensPath, roadsPath, trackPath } from './campusMap'
import { GATE, gateLanesPath, pathwaysPath } from './campusPathways'
import { HERO_QUERIES } from './heroQueries'
import { buildTimeline } from './heroTimeline'
import { IconDoor, IconPin, IconSearch, IconTurnLeft, IconTurnRight } from './icons'

// Hand-drawn wandering traces that start at the Gate node and go nowhere useful.
const TRAILS = [
  'M240 774.5 C253 742.5 231 716.5 253 696.5 S309 700.5 313 730.5 S285 764.5 299 786.5',
  'M240 774.5 C299 780.5 347 760.5 399 780.5 S451 844.5 419 876.5 S365 874.5 377 842.5',
  'M240 774.5 C233 820.5 261 846.5 293 858.5 S347 904.5 317 936.5 S273 936.5 283 910.5',
]
const TRAIL_ENDS = [
  { x: 299, y: 786.5 },
  { x: 377, y: 842.5 },
  { x: 283, y: 910.5 },
]

/** `m` is for the phone frame, whose right edge cuts through the east of campus: anchor the label at its end, or hide it. */
type Label = { x: number; y: number; t: string; a?: 'start' | 'middle' | 'end'; m?: 'end' | 'hide' }
const LABELS: Label[] = [
  { x: 752, y: 900, t: 'Administration', m: 'end' },
  { x: 846, y: 860, t: 'Canteen' },
  { x: 676, y: 1062, t: 'Main Library', a: 'end', m: 'hide' },
  { x: 785, y: 1012, t: 'Faculty', m: 'hide' },
  { x: 578, y: 1112, t: 'CCSICT', a: 'end' },
  { x: 740, y: 1180, t: 'CAS', m: 'end' },
  { x: 1128, y: 806, t: 'Engineering', a: 'middle' },
  { x: 1268, y: 1008, t: 'Sports Oval', a: 'middle' },
  { x: 1145, y: 958, t: 'CBAPA' },
  { x: 1286, y: 580, t: 'Graduate School', a: 'middle' },
  { x: 896, y: 590, t: 'Student Center' },
  { x: 1080, y: 1130, t: 'Amphitheater', a: 'middle' },
]

const anchor = (x: number, y: number): CSSProperties => ({ ['--mx' as string]: x, ['--my' as string]: y })

/* ---------- search typing, synced to the CSS timeline ---------- */

const TIMELINE = buildTimeline(HERO_QUERIES)
const { beats: BEATS, cycle: CYCLE_MS } = TIMELINE

/**
 * Types each query in step with the hero's CSS cycle. The search card's own CSS animation is the
 * clock, so pausing the loop (offscreen, hidden tab) pauses the typing too. Only a short text node
 * changes, about 80 times per cycle.
 */
function useTypedQuery(running: boolean) {
  const card = useRef<HTMLDivElement>(null)
  const text = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const cardEl = card.current
    const textEl = text.current
    if (!cardEl || !textEl) return
    const show = (query: string, n: number) => {
      const next = query.slice(0, n)
      if (textEl.textContent !== next) textEl.textContent = next
      cardEl.toggleAttribute('data-typing', n > 0 && n < query.length)
    }
    const lead = HERO_QUERIES[0].query
    if (!running) {
      // Paused or reduced motion: keep whatever is on screen, but never leave the field empty in the static frame.
      if (!textEl.textContent) show(lead, lead.length)
      return
    }
    const clock = cardEl.getAnimations?.().find(a => (a as CSSAnimation).animationName === 'lp-search')
    if (!clock) { show(lead, lead.length); return }
    const tick = () => {
      const t = (Number(clock.currentTime) || 0) % CYCLE_MS
      let i = 0
      while (i + 1 < BEATS.length && t >= BEATS[i + 1].start) i++
      const e = t - BEATS[i].typeAt
      const keys = BEATS[i].keys
      let n = 0
      while (n < keys.length && keys[n] <= e) n++
      show(HERO_QUERIES[i].query, n)
    }
    tick()
    const id = window.setInterval(tick, 32)
    return () => window.clearInterval(id)
  }, [running])
  return { card, text }
}

/** Per-search elements are always rendered; the first is the reduced-motion still, the rest are hidden in it. */
const alt = (i: number) => (i === 0 ? '' : ' is-alt')
const run = (name: string): CSSProperties => ({ animationName: name })

export function HeroMap({ running }: { running: boolean }) {
  const typed = useTypedQuery(running)
  return (
    <div className="lp-map" aria-hidden="true" style={{ ['--lp-cycle' as string]: `${CYCLE_MS}ms` }}>
      <style>{TIMELINE.css}</style>
      <div className="lp-stage" style={{ width: MAP_W, height: MAP_H }}>
        {/* Static base map: painted once. */}
        <svg className="lp-map-svg lp-map-base" width={MAP_W} height={MAP_H} viewBox={`0 0 ${MAP_W} ${MAP_H}`}>
          <path d={greensPath} className="lp-m-green" />
          <path d={trackPath} className="lp-m-track" />
          <g className="lp-m-roads">
            <path d={roadsPath} className="lp-m-road-casing" />
            <path d={gateLanesPath} className="lp-m-road-casing" />
            <path d={roadsPath} className="lp-m-road" />
            <path d={gateLanesPath} className="lp-m-road" />
          </g>
          <path d={buildingsPath} className="lp-m-shadow" transform="translate(2.6 3.4)" />
          <path d={collegesPath} className="lp-m-shadow" transform="translate(2.6 3.4)" />
          <path d={buildingsPath} className="lp-m-bldg" />
          <path d={collegesPath} className="lp-m-bldg lp-m-bldg--named" />
          {/* The walking pathways admins drew in the Map Editor: every hero route runs on these. */}
          <path d={pathwaysPath} className="lp-m-pathways" />
          <g className="lp-m-labels">
            {LABELS.map(l => (
              <text key={l.t} x={l.x} y={l.y} textAnchor={l.a ?? 'start'} data-m={l.m}>{l.t}</text>
            ))}
          </g>
        </svg>

        {/* Animated overlay: only these paths repaint while the loop runs. */}
        <svg className="lp-map-svg lp-map-fx" width={MAP_W} height={MAP_H} viewBox={`0 0 ${MAP_W} ${MAP_H}`}>
          <defs>
            {TRAILS.map((d, i) => (
              <mask key={d} id={`lp-trail-mask-${i}`} maskUnits="userSpaceOnUse" x="0" y="0" width={MAP_W} height={MAP_H}>
                <path d={d} pathLength={1} className={`lp-trail-reveal lp-t${i}`} />
              </mask>
            ))}
            <radialGradient id="lp-gate-glow">
              <stop offset="0" stopColor="#f2c300" stopOpacity="0.38" />
              <stop offset="1" stopColor="#f2c300" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Lost: dotted wandering traces revealed by an animated mask. */}
          {TRAILS.map((d, i) => (
            <path key={d} d={d} className={`lp-trail lp-trail-${i}`} mask={`url(#lp-trail-mask-${i})`} />
          ))}

          {/* Each search's route: soft glow + crisp line, drawn with stroke-dashoffset. */}
          {HERO_QUERIES.map((q, i) => (
            <g key={i} className={`lp-route-set${alt(i)}`}>
              <path d={q.route} pathLength={1} className="lp-route-glow" style={run(`lp-route-${i}`)} />
              <path d={q.route} pathLength={1} className="lp-route" style={run(`lp-route-${i}`)} />
            </g>
          ))}

          <circle cx={GATE.x} cy={GATE.y} r="64" fill="url(#lp-gate-glow)" className="lp-gate-glow" />
        </svg>

        {/* HTML movers sit in the same scaled stage, so offset-path uses map units. */}
        {TRAILS.map((d, i) => (
          <span key={d} className={`lp-lost lp-lost-${i}`} style={{ offsetPath: `path('${d}')` }} />
        ))}
        {TRAIL_ENDS.map((p, i) => (
          <span key={i} className={`lp-q lp-q-${i}`} style={{ left: p.x, top: p.y }}>?</span>
        ))}

        {HERO_QUERIES.map((q, i) => (
          <span key={i} className={`lp-dest${alt(i)}`} style={{ left: q.dest.x, top: q.dest.y }}>
            <span className="lp-dest-ring" style={run(`lp-dest-ring-${i}`)} />
            <span className="lp-dest-dot" style={run(`lp-dest-${i}`)} />
          </span>
        ))}

        {HERO_QUERIES.map((q, i) => (
          <span key={i} className="lp-walker" style={{ offsetPath: `path('${q.route}')`, animationName: `lp-walk-${i}` }}>
            <span className="lp-walker-halo" />
            <span className="lp-walker-dot" />
          </span>
        ))}

        <span className="lp-gate" style={{ left: GATE.x, top: GATE.y }}>
          <span className="lp-gate-ring" />
          <span className="lp-gate-mark"><img src={logo} alt="" width={34} height={44} /></span>
        </span>
        <span className="lp-gate-label" style={{ left: GATE.x, top: GATE.y }}>Main Gate</span>
      </div>

      <div className="lp-map-veil" />
      <div className="lp-map-meta">
        <span className="lp-north"><svg width="12" height="14" viewBox="0 0 12 14"><path d="M6 0 11 13 6 10 1 13Z" fill="currentColor" /></svg>N</span>
        {/* 1 map unit is about 0.8825 m, so 100 m is 113.3 units. */}
        <span className="lp-scale"><i />100 m</span>
      </div>

      {/* Cards live outside the scaled stage so text stays crisp at every scale. */}
      <div className="lp-cardpin lp-cardpin--search" style={anchor(275, 591)}>
        <div className="lp-mcard lp-search" ref={typed.card}>
          <div className="lp-search-field"><IconSearch size={16} /><span className="lp-search-text" ref={typed.text} /></div>
          {/* One row per search, stacked in the same cell; each shows only during its own search. */}
          <div className="lp-search-hits">
            {HERO_QUERIES.map((q, i) => (
              <div key={i} className={`lp-search-hit${alt(i)}`} style={run(`lp-hit-${i}`)}>
                <span className="lp-search-ico"><IconDoor size={15} /></span>
                <b>{q.name}</b>
                <small className="lp-search-bldg">{q.building}</small>
                <small className="lp-search-meta">{q.floor} · {q.minutes} min walk</small>
                <span className="lp-search-go">Go</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {HERO_QUERIES.map((q, i) => q.turn && (
        <div key={i} className={`lp-cardpin lp-cardpin--turn is-${q.turn.anchor.side}`} style={anchor(q.turn.anchor.x, q.turn.anchor.y)}>
          <div className="lp-mcard lp-turn" style={run(`lp-turn-${i}`)}>
            <span className="lp-turn-ico">{q.turn.dir === 'left' ? <IconTurnLeft size={18} /> : <IconTurnRight size={18} />}</span>
            <span><b>{q.turn.title}</b><small>{q.turn.sub}</small></span>
          </div>
        </div>
      ))}
      {HERO_QUERIES.map((q, i) => (
        <div key={i} className={`lp-cardpin lp-cardpin--arrive is-${q.arrive.side}`} style={anchor(q.arrive.x, q.arrive.y)}>
          <div className={`lp-mcard lp-arrive${alt(i)}`} style={run(`lp-arrive-${i}`)}>
            <span className="lp-arrive-ico"><IconPin size={18} /></span>
            <span><small>You've arrived</small><b>{q.name}</b></span>
          </div>
        </div>
      ))}
    </div>
  )
}
