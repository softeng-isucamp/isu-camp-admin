import { useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { ADMIN_LOGIN_URL, APK_URL, WEB_APP_HOST, WEB_APP_URL, isLandingHost } from './links'
import './landing.css'
import { HeroMap } from './HeroMap'
import { apkQr, webQr } from './campusMap'
import {
  IconArrowRight, IconArrowUpRight, IconBolt, IconCheck, IconCloudOff, IconCompass, IconDownload, IconGlobe, IconLayers,
  IconList, IconMap, IconNodes, IconPhone, IconPlus, IconSchool, IconShare, IconShield, IconTree, IconUsers, IconWalk,
} from './icons'
import logo from './assets/kumpas-logo.webp'
import shotSearch from './assets/search-where-do-i-enroll.webp'
import shotRouteDetails from './assets/route-details.webp'
import shotNavMid from './assets/nav-mid-route.webp'
import shotArrival from './assets/nav-arrival.webp'
import shotHome from './assets/home-map.webp'
import shotOptions from './assets/route-options.webp'
import shotOffline from './assets/offline-map-ready.webp'
import shotAdminMap from './assets/admin-map-editor.webp'
import shotAdminLocations from './assets/admin-locations.webp'

export { APK_URL, WEB_APP_HOST, WEB_APP_URL }

const RM_QUERY = '(prefers-reduced-motion: reduce)'

/* ---------- which call to action to lead with ---------- */

type Platform = 'android' | 'ios' | 'desktop'

/** Android phones get the APK first, iPhones and iPads only the web app, everything else the web app plus a QR to the APK. */
function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'desktop'
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return 'android'
  // iPadOS reports itself as a Mac, so a touch-capable "Macintosh" is an iPad.
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  return 'desktop'
}

function usePlatform(): Platform {
  const [platform] = useState(detectPlatform)
  return platform
}

/** The two hero/footer buttons, ordered for the visitor's device. */
function PrimaryCtas({ platform }: { platform: Platform }) {
  const apk = <a className="lp-btn lp-btn--primary" href={APK_URL}><IconDownload size={19} />Download for Android</a>
  const web = (primary: boolean) => <a className={`lp-btn ${primary ? 'lp-btn--primary' : 'lp-btn--ghost'}`} href={WEB_APP_URL}>Open the web app<IconArrowRight size={18} className="lp-nudge" /></a>
  if (platform === 'android') return <>{apk}{web(false)}</>
  if (platform === 'ios') return web(true)
  return <>{web(true)}<a className="lp-btn lp-btn--ghost" href="#download">Get the Android app<IconArrowRight size={18} className="lp-nudge" /></a></>
}

/* ---------- small hooks ---------- */

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia(RM_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(RM_QUERY)
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

function useInView<T extends Element>(ref: RefObject<T | null>, rootMargin = '0px') {
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin })
    io.observe(el)
    return () => io.disconnect()
  }, [ref, rootMargin])
  return inView
}

/** The admin shell sets body { min-width: 1080px }; a public page must reflow to phone width. */
function usePublicPageChrome() {
  useEffect(() => {
    const body = document.body
    const html = document.documentElement
    const prev = { minWidth: body.style.minWidth, bg: body.style.background, scroll: html.style.scrollBehavior }
    body.style.minWidth = '0'
    body.style.background = '#08241a'
    if (!window.matchMedia(RM_QUERY).matches) html.style.scrollBehavior = 'smooth'
    const title = document.title
    document.title = 'Kumpas · Stop guessing. Start navigating.'
    return () => {
      body.style.minWidth = prev.minWidth
      body.style.background = prev.bg
      html.style.scrollBehavior = prev.scroll
      document.title = title
    }
  }, [])
}

/** False while the tab is in the background, so loops and timers can stop. */
function usePageVisible() {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  useEffect(() => {
    const on = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return visible
}

/**
 * Non-uniform stagger for items that enter the viewport together: the gaps shrink
 * (80, 60, 50, 40 ms) so a row reads as one wave, and the fifth item onward waits no longer.
 */
const STAGGER_MS = [0, 80, 140, 190, 230]

/**
 * Scroll reveal for [data-reveal], once. Items that cross into view in the same
 * observer batch are staggered in reading order; an explicit data-d (ms) overrides that.
 * Hidden state is only applied once JS has armed the observer, and anything already
 * scrolled past is shown at once, so content can never get stuck invisible.
 */
function useReveal(root: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    if (window.matchMedia(RM_QUERY).matches || typeof IntersectionObserver === 'undefined') return
    const items = Array.from(el.querySelectorAll<HTMLElement>('[data-reveal]'))
    el.classList.add('lp-reveal-on')
    const io = new IntersectionObserver(entries => {
      const entering = entries
        .filter(e => e.isIntersecting || e.boundingClientRect.bottom < 0)
        .sort((a, b) => Math.round(a.boundingClientRect.top / 40) - Math.round(b.boundingClientRect.top / 40) || a.boundingClientRect.left - b.boundingClientRect.left)
      entering.forEach((e, i) => {
        const t = e.target as HTMLElement
        const d = t.dataset.d ?? String(STAGGER_MS[Math.min(i, STAGGER_MS.length - 1)])
        t.style.setProperty('--d', `${d}ms`)
        t.classList.add('is-in')
        io.unobserve(t)
      })
    }, { rootMargin: '0px 0px -8% 0px' })
    items.forEach(i => io.observe(i))
    // Once an entrance has played, drop the animation so a later display toggle (a breakpoint) cannot replay it.
    const done = (e: AnimationEvent) => {
      const t = e.target as HTMLElement
      if (e.animationName === 'lp-rise' && t.classList.contains('is-in')) t.classList.add('is-done')
    }
    el.addEventListener('animationend', done)
    return () => { io.disconnect(); el.removeEventListener('animationend', done); el.classList.remove('lp-reveal-on') }
  }, [root])
}

/* ---------- building blocks ---------- */

function StatusBar({ tone, className = '' }: { tone: 'dark' | 'light'; className?: string }) {
  return (
    <div className={`lp-phone-status is-${tone} ${className}`}>
      <span>8:02</span>
      <i className="lp-phone-cam" />
      <span className="lp-phone-sys" aria-hidden="true">
        <svg width="15" height="10" viewBox="0 0 15 10"><path d="M1 9h2V7H1zM5 9h2V5H5zM9 9h2V3H9zM13 9h1.5V1H13z" fill="currentColor" /></svg>
        <svg width="20" height="10" viewBox="0 0 20 10"><rect x=".5" y=".5" width="16" height="9" rx="2.2" fill="none" stroke="currentColor" opacity=".5" /><rect x="2" y="2" width="11" height="6" rx="1.2" fill="currentColor" /><rect x="17.6" y="3.4" width="1.6" height="3.2" rx=".6" fill="currentColor" opacity=".5" /></svg>
      </span>
    </div>
  )
}

type PhoneProps = { src: string; alt: string; tone?: 'dark' | 'light'; lazy?: boolean } & HTMLAttributes<HTMLDivElement> & { 'data-reveal'?: boolean | string; 'data-d'?: number }

function Phone({ src, alt, tone = 'dark', lazy = true, className = '', ...rest }: PhoneProps) {
  return (
    <div className={`lp-phone ${className}`} {...rest}>
      <div className="lp-phone-screen">
        <StatusBar tone={tone} />
        <img src={src} alt={alt} width={540} height={1146} loading={lazy ? 'lazy' : 'eager'} decoding="async" />
      </div>
    </div>
  )
}

function Qr({ d, size, label }: { d: string; size: number; label: string }) {
  const q = 4
  return (
    <svg className="lp-qr" viewBox={`${-q} ${-q} ${size + q * 2} ${size + q * 2}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x={-q} y={-q} width={size + q * 2} height={size + q * 2} fill="#fff" />
      <path d={d} fill="#0b2a1c" />
    </svg>
  )
}

function Eyebrow({ children, tone = 'light' }: { children: ReactNode; tone?: 'light' | 'dark' }) {
  return <p className={`lp-eyebrow is-${tone}`}>{children}</p>
}

/* ---------- sections ---------- */

/** Signed in, the admin entry goes straight to the dashboard; signed out, to sign-in. `/` itself never redirects. */
function SessionAdminLink({ className, children }: { className?: string; children?: ReactNode }) {
  const { session } = useAuth()
  return session
    ? <Link className={className} to="/dashboard">Go to dashboard{children}</Link>
    : <Link className={className} to="/login">Admin sign in{children}</Link>
}

/** On the landing host there is no session to read (and no AuthProvider), so it is always an absolute link to the admin host. */
function AdminLink(props: { className?: string; children?: ReactNode }) {
  if (isLandingHost()) return <a className={props.className} href={ADMIN_LOGIN_URL}>Admin sign in{props.children}</a>
  return <SessionAdminLink {...props} />
}

function Nav() {
  // A 1px sentinel 24px down the page: once it leaves the viewport the nav gains its backdrop.
  // No scroll listener, so nothing runs per scroll frame.
  const sentinel = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <>
    <div ref={sentinel} className="lp-nav-sentinel" aria-hidden="true" />
    <header className={`lp-nav${scrolled ? ' is-scrolled' : ''}`}>
      <div className="lp-container lp-nav-inner">
        <a className="lp-brand" href="#top" aria-label="Kumpas home">
          <img src={logo} alt="" width={26} height={34} />
          <span>Kumpas</span>
        </a>
        <nav className="lp-nav-links" aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <a href="#download">Download</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="lp-nav-actions">
          <AdminLink className="lp-nav-admin" />
          <a className="lp-btn lp-btn--sm lp-btn--light" href={WEB_APP_URL}>Open web app</a>
        </div>
      </div>
    </header>
    </>
  )
}

function Hero({ platform }: { platform: Platform }) {
  const ref = useRef<HTMLElement>(null)
  const inView = useInView(ref)
  const visible = usePageVisible()
  const reduced = useReducedMotion()
  const running = inView && visible && !reduced
  return (
    <section id="top" ref={ref} className="lp-hero" data-run={running ? '' : undefined} data-reduced={reduced ? '' : undefined}>
      <HeroMap running={running} />
      <div className="lp-container lp-hero-copy">
        <p className="lp-hero-kicker"><span className="lp-dot" />Isabela State University · Echague campus</p>
        <h1 className="lp-hero-title"><span className="lp-line">Stop guessing.</span> <span className="lp-line is-accent">Start navigating.</span></h1>
        <p className="lp-hero-lede">
          Kumpas finds any building, office, room or CR on campus, shows you the walk, and guides you there turn by turn, even without signal.
        </p>
        <div className="lp-hero-ctas">
          <PrimaryCtas platform={platform} />
        </div>
        {platform !== 'android' && <p className="lp-hero-note">On iPhone? The web app runs right in Safari. No install needed.</p>}
        <ul className="lp-hero-facts">
          <li><IconCloudOff size={17} />Offline maps</li>
          <li><IconLayers size={17} />Rooms, offices &amp; CRs</li>
          <li><IconWalk size={17} />Turn-by-turn on foot</li>
        </ul>
      </div>
      <p className="lp-hero-credit">Campus map data © OpenStreetMap contributors</p>
    </section>
  )
}

const AUDIENCES = [
  { icon: IconSchool, who: 'Freshmen', line: 'Find your first classroom, the Registrar and the canteen without asking five strangers on the way.' },
  { icon: IconUsers, who: 'Visitors & parents', line: 'Walking in through the main gate for the first time? Search the office you need and follow the route in.' },
  { icon: IconCompass, who: 'Every student', line: 'The nearest CR, a faculty office, a room in another college. Found in seconds, not after three wrong turns.' },
]

function Audience() {
  return (
    <section className="lp-section lp-audience">
      <div className="lp-container">
        <div className="lp-audience-head" data-reveal>
          <Eyebrow tone="dark">Who it's for</Eyebrow>
          <h2 className="lp-h2">A big campus, made <em>obvious.</em></h2>
          <p className="lp-sub">From the gate on the west road to the Sports Oval, Kumpas knows where everything is, so nobody has to wander.</p>
        </div>
        <div className="lp-audience-grid">
          {AUDIENCES.map(({ icon: Icon, who, line }) => (
            <article key={who} className="lp-aud-card" data-reveal>
              <span className="lp-aud-icon"><Icon size={22} /></span>
              <h3>{who}</h3>
              <p>{line}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

const STEPS = [
  { k: 'Search', title: 'Ask the way you would ask a friend', body: 'Type a building, an office, a room, or just “where do I enroll”. Kumpas looks inside buildings too.', src: shotSearch, tone: 'dark' as const, alt: 'Kumpas search for “where do i enroll” showing one result: the Office of the Registrar, on the ground floor of the Administration Building' },
  { k: 'Preview', title: 'See the walk before you take it', body: 'Check the route, distance and estimated walking time. Preview it on the map, or start right away.', src: shotRouteDetails, tone: 'dark' as const, alt: 'Route details from my current location to the Administration Building: shortest route, 500 metres, about 7 minutes' },
  { k: 'Navigate', title: 'Turn by turn, on foot', body: 'Clear instructions at every corner, with the distance to the next turn and the time left.', src: shotNavMid, tone: 'light' as const, alt: 'Turn-by-turn navigation: turn left toward the Administration Building, 101 metres remaining' },
  { k: 'Arrive', title: 'The right door, first try', body: 'Kumpas tells you the moment you have arrived. No circling the building, no asking around.', src: shotArrival, tone: 'light' as const, alt: 'Arrival screen: You have arrived at the Administration Building' },
]
const STEP_MS = 5200

type StepState = { active: number; prev: number; dir: 1 | -1 }

function HowItWorks() {
  const ref = useRef<HTMLElement>(null)
  const inView = useInView(ref, '-20% 0px -20% 0px')
  const visible = usePageVisible()
  const reduced = useReducedMotion()
  const [{ active, prev, dir }, setStep] = useState<StepState>({ active: 0, prev: -1, dir: 1 })
  const [auto, setAuto] = useState(true)
  const autoplay = auto && !reduced
  // The progress bar's CSS animation is the timer: it pauses offscreen, in a background tab
  // and while the pointer rests on the section, and its animationend advances the step.
  const playing = autoplay && inView && visible
  const go = (next: number, forward: boolean) =>
    setStep(s => (next === s.active ? s : { active: next, prev: s.active, dir: forward ? 1 : -1 }))
  return (
    <section id="how" ref={ref} className="lp-section lp-how">
      <div className="lp-container lp-how-grid">
        <div className="lp-how-copy">
          <div data-reveal>
            <Eyebrow tone="dark">How it works</Eyebrow>
            <h2 className="lp-h2">From the gate to the room in four steps.</h2>
          </div>
          <ol className="lp-steps" data-reveal>
            {STEPS.map((s, i) => (
              <li key={s.k} className={i === active ? 'is-active' : undefined}>
                <button type="button" onClick={() => { go(i, i > active); setAuto(false) }} aria-pressed={i === active}>
                  <span className="lp-step-num">{String(i + 1).padStart(2, '0')}</span>
                  <span className="lp-step-text">
                    <span className="lp-step-k">{s.k}</span>
                    <span className="lp-step-title">{s.title}</span>
                    <span className="lp-step-body">{s.body}</span>
                  </span>
                  <span className="lp-step-bar" aria-hidden="true">
                    {i === active && (
                      <i
                        key={active}
                        className={autoplay ? 'is-running' : 'is-full'}
                        data-paused={playing ? undefined : ''}
                        style={{ animationDuration: `${STEP_MS}ms` }}
                        onAnimationEnd={() => go((active + 1) % STEPS.length, true)}
                      />
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
        <div className="lp-how-stage" data-reveal>
          <div className="lp-how-halo" aria-hidden="true" />
          <div className="lp-phone lp-phone--stack">
            <div className="lp-phone-screen">
              {/* Both status bars are always rendered; the light one crossfades over the dark one. */}
              <div className="lp-phone-status-swap" data-tone={STEPS[active].tone}>
                <StatusBar tone="dark" />
                <StatusBar tone="light" className="is-over" />
              </div>
              <div className="lp-phone-frames" data-dir={dir}>
                {STEPS.map((s, i) => (
                  <img
                    key={s.k} src={s.src} alt={i === active ? s.alt : ''} aria-hidden={i !== active}
                    className={i === active ? 'is-active' : i === prev ? 'is-leaving' : undefined}
                    width={540} height={1146} loading="lazy" decoding="async"
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="lp-how-chip" aria-hidden="true"><IconWalk size={16} />Walking directions</div>
        </div>
      </div>
    </section>
  )
}

const PLACES: [string, string][] = [
  ['CCSICT', 'Computing Studies, ICT'], ['CAS', 'Arts and Sciences'], ['COE', 'Engineering'], ['CED', 'Education'],
  ['CBAPA', 'Business, Accountancy & Public Admin'], ['CA', 'Agriculture'], ['CVM', 'Veterinary Medicine'],
]
const LANDMARKS = ['Administration Building', 'Registrar', 'Main Library', 'Canteen', 'Sports Oval']

function Features() {
  return (
    <section id="features" className="lp-section lp-features">
      <div className="lp-container">
        <div className="lp-features-head" data-reveal>
          <Eyebrow tone="dark">Features</Eyebrow>
          <h2 className="lp-h2">Everything you need to find your way. Nothing you don't.</h2>
        </div>
        <div className="lp-bento">
          <article className="lp-tile lp-tile--indoor" data-reveal>
            <div className="lp-tile-copy">
              <span className="lp-tile-icon"><IconLayers size={20} /></span>
              <h3>Inside the building, not just outside it.</h3>
              <p>Kumpas maps indoor locations, from classrooms and offices to comfort rooms, so search takes you to the right door, not just the right building.</p>
            </div>
            <div className="lp-tile-visual lp-indoor-visual">
              <Phone src={shotSearch} alt="Search results for “where do i enroll”: the Office of the Registrar, inside the Administration Building" className="lp-phone--crop" />
              <div className="lp-floor-card">
                <span className="lp-floor-k">Administration Building</span>
                <span className="lp-floor-row"><i />Office of the Registrar<b>Ground floor</b></span>
                <span className="lp-floor-row"><i />Cashiering Office<b>Ground floor</b></span>
                <span className="lp-floor-row"><i />ICT Office<b>2nd floor</b></span>
              </div>
            </div>
          </article>

          <article className="lp-tile lp-tile--offline" data-reveal>
            <span className="lp-tile-icon is-yellow"><IconCloudOff size={20} /></span>
            <h3>No signal? Still found.</h3>
            <p>Download the campus map once in the Android app, then search and get directions with zero mobile data.</p>
            <div className="lp-offline-card">
              <span className="lp-offline-check"><IconCheck size={18} /></span>
              <span><b>ISU Map (Echague Campus)</b><small>Offline ready</small></span>
            </div>
          </article>

          <article className="lp-tile lp-tile--routes" data-reveal>
            <span className="lp-tile-icon"><IconWalk size={20} /></span>
            <h3>Shortest or shaded.</h3>
            <p>Take the most direct path, or pick a shaded one when the midday sun is out.</p>
            <div className="lp-options">
              <span className="lp-option is-on"><span className="lp-option-ico is-bolt"><IconBolt size={17} /></span><span><b>Shortest route</b><small>Most direct path</small></span><i /></span>
              <span className="lp-option"><span className="lp-option-ico"><IconTree size={17} /></span><span><b>Shaded path</b><small>Shaded, wider</small></span><i /></span>
            </div>
          </article>

          <article className="lp-tile lp-tile--places" data-reveal>
            <span className="lp-tile-icon"><IconMap size={20} /></span>
            <h3>Every college, one search away.</h3>
            <p>From CCSICT to CVM, plus the offices and landmarks everyone ends up looking for.</p>
            <ul className="lp-places">
              {PLACES.map(([a, n]) => <li key={a}><b>{a}</b><span>{n}</span></li>)}
            </ul>
            <ul className="lp-landmarks">
              {LANDMARKS.map(l => <li key={l}>{l}</li>)}
            </ul>
          </article>

          <article className="lp-tile lp-tile--anywhere" data-reveal>
            <span className="lp-tile-icon is-yellow"><IconPhone size={20} /></span>
            <h3>Android app or any browser.</h3>
            <p>Install the Android app, or open {WEB_APP_HOST} on any phone, iPhone included.</p>
            <ul className="lp-platforms">
              <li><IconDownload size={17} /><span><b>Android</b>APK download</span></li>
              <li><IconGlobe size={17} /><span><b>Web app</b>{WEB_APP_HOST}</span></li>
            </ul>
            <a className="lp-link" href="#download">Get Kumpas<IconArrowRight size={16} className="lp-nudge" /></a>
          </article>
        </div>
      </div>
    </section>
  )
}

function Showcase() {
  return (
    <section className="lp-showcase" aria-label="Kumpas app screens">
      <div className="lp-container lp-showcase-inner">
        <div className="lp-showcase-copy" data-reveal>
          <Eyebrow>The app</Eyebrow>
          <h2 className="lp-h2 is-light">Built around the campus you actually walk.</h2>
          <p className="lp-sub is-light">Real building footprints, real walkways, and the places students and visitors look for every day.</p>
        </div>
        {/* The centre phone leads; the tilted pair follows one beat later. */}
        <div className="lp-showcase-row">
          <Phone src={shotHome} alt="Kumpas home map with colleges, offices, parking and canteens marked across campus" className="lp-phone--tilt-l" data-reveal data-d={110} />
          <Phone src={shotOptions} alt="Choose route: shortest route or shaded path to the Administration Building" className="lp-phone--lift" data-reveal data-d={0} />
          <Phone src={shotOffline} alt="Offline map screen: ISU Map (Echague Campus) downloaded and offline ready" className="lp-phone--tilt-r" data-reveal data-d={110} />
        </div>
      </div>
    </section>
  )
}

function Download({ platform }: { platform: Platform }) {
  return (
    <section id="download" className="lp-section lp-download">
      <div className="lp-container">
        <div className="lp-download-head" data-reveal>
          <Eyebrow>Download</Eyebrow>
          <h2 className="lp-h2 is-light">Take the campus with you.</h2>
          <p className="lp-sub is-light">{platform === 'ios' ? 'Kumpas runs in your browser. Nothing to install.' : 'Two ways in. Pick the one that fits your phone.'}</p>
        </div>
        <div className={`lp-dl-grid${platform === 'ios' ? ' is-single' : ''}`}>
          {platform !== 'ios' && <article className="lp-dl-card is-primary" data-reveal>
            <div className="lp-dl-top">
              <div>
                <p className="lp-dl-k"><IconPhone size={16} />Android</p>
                <h3>The full app, with offline maps.</h3>
              </div>
              <figure className="lp-dl-qr">
                <Qr d={apkQr.d} size={apkQr.size} label="QR code that downloads the Kumpas Android APK" />
                <figcaption>Scan with your Android phone</figcaption>
              </figure>
            </div>
            <ol className="lp-dl-steps">
              <li><b>Download the APK</b> from the button below or the QR code.</li>
              <li><b>Allow the install</b> if Android asks. Apps downloaded outside an app store need this once.</li>
              <li><b>Open Kumpas</b> and download the offline campus map.</li>
            </ol>
            <a className="lp-btn lp-btn--primary lp-btn--block" href={APK_URL}><IconDownload size={19} />Download APK</a>
          </article>}
          <article className="lp-dl-card" data-reveal>
            <div className="lp-dl-top">
              <div>
                <p className="lp-dl-k"><IconGlobe size={16} />iPhone &amp; any browser</p>
                <h3>The web app. Nothing to install.</h3>
              </div>
              <figure className="lp-dl-qr">
                <Qr d={webQr.d} size={webQr.size} label={`QR code that opens ${WEB_APP_HOST}`} />
                <figcaption>Scan to open {WEB_APP_HOST}</figcaption>
              </figure>
            </div>
            <ol className="lp-dl-steps">
              <li><b>There is no iOS app</b>, so iPhone users use the web app in Safari.</li>
              <li><b>Open {WEB_APP_HOST}</b> on any phone, tablet or laptop.</li>
              <li><b>Keep it handy:</b> tap <IconShare size={14} className="lp-inline-ico" /> Share, then “Add to Home Screen”.</li>
            </ol>
            <a className="lp-btn lp-btn--light lp-btn--block" href={WEB_APP_URL}>Open {WEB_APP_HOST}<IconArrowUpRight size={18} className="lp-nudge is-up" /></a>
          </article>
        </div>
      </div>
    </section>
  )
}

function Admins() {
  return (
    <section id="admins" className="lp-section lp-admins">
      <div className="lp-container lp-admins-grid">
        <div className="lp-admins-copy" data-reveal>
          <Eyebrow tone="dark">For campus admins</Eyebrow>
          <h2 className="lp-h2">A map that stays true, kept by people who know the campus.</h2>
          <p className="lp-sub">A small team of campus staff maintains Kumpas from a desktop admin portal. When a room moves or a walkway opens, they update it there.</p>
          <ul className="lp-admin-list">
            <li><span><IconNodes size={19} /></span><div><b>Map editor</b>Draw building footprints, plot locations and calibrate the walking network.</div></li>
            <li><span><IconList size={19} /></span><div><b>Location directory</b>Keep buildings, offices, rooms and CRs accurate, with photos and search keywords.</div></li>
            <li><span><IconShield size={19} /></span><div><b>Oversight</b>Admin permissions, system logs and backups, built in.</div></li>
          </ul>
          <AdminLink className="lp-btn lp-btn--dark"><IconArrowRight size={18} className="lp-nudge" /></AdminLink>
          <p className="lp-admin-note">The portal is for authorised campus staff only.</p>
        </div>
        <div className="lp-admins-visual" data-reveal>
          <div className="lp-browser">
            <div className="lp-browser-bar"><i /><i /><i /><span>Kumpas Admin Portal · Map Editor</span></div>
            <img src={shotAdminMap} alt="Kumpas admin portal map editor showing building footprints, route nodes and walking paths around the Administration Building" width={1400} height={788} loading="lazy" decoding="async" />
          </div>
          <div className="lp-browser lp-browser--float">
            <div className="lp-browser-bar"><i /><i /><i /><span>Locations</span></div>
            <img src={shotAdminLocations} alt="Admin portal location directory listing CCSICT and the Administration Building with their indoor locations" width={1400} height={788} loading="lazy" decoding="async" />
          </div>
        </div>
      </div>
    </section>
  )
}

const FAQS: { q: string; a: ReactNode }[] = [
  { q: 'What is Kumpas?', a: <>Kumpas is a campus navigation app for the Isabela State University main campus in Echague. Search any building, office, room or CR, preview the walking route, then follow turn-by-turn directions.</> },
  { q: 'Is there an iPhone app?', a: <>Not at the moment. iPhone users can use the web app at <a href={WEB_APP_URL}>{WEB_APP_HOST}</a> in Safari. There is nothing to install.</> },
  { q: 'How do I install the Android app?', a: <>Download the APK from this page and open the file. If Android asks, allow installs from your browser or file manager, then tap Install. You only need to allow it once.</> },
  { q: 'Does Kumpas work without internet?', a: <>Yes, in the Android app. Download the offline campus map once and you can search and get directions without mobile data. Offline use in the web app: <span className="lp-confirm">[confirm]</span></> },
  { q: 'Can it find rooms, offices and CRs inside buildings?', a: <>Yes. Besides buildings, Kumpas lists indoor locations such as classrooms, offices, labs and comfort rooms. Ask “where do i pay” and it takes you to the Cashiering Office on the ground floor of the Administration Building. How much indoor detail a building has depends on what campus admins have added so far. <span className="lp-confirm">[confirm]</span></> },
  { q: 'Which places can I find?', a: <>Colleges such as CCSICT, CAS, COE, CED, CBAPA, CA and CVM, plus campus landmarks like the Administration Building, the Registrar, the Main Library, the Canteen and the Sports Oval.</> },
  { q: 'Who keeps the map up to date?', a: <>A small team of campus admins maintains the map and the location directory through the Kumpas admin portal.</> },
  { q: 'Does Kumpas cost anything?', a: <>Kumpas is free for students, staff and visitors. <span className="lp-confirm">[confirm]</span></> },
]

function Faq() {
  // A disclosure list rather than <details>: <details> cannot animate its closing, and the
  // grid-rows 0fr -> 1fr transition needs the panel to stay mounted.
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set([0]))
  const toggle = (i: number) => setOpen(s => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n })
  return (
    <section id="faq" className="lp-section lp-faq">
      <div className="lp-container lp-faq-grid">
        <div className="lp-faq-head" data-reveal>
          <Eyebrow tone="dark">FAQ</Eyebrow>
          <h2 className="lp-h2">Questions, answered.</h2>
          <p className="lp-sub">Still stuck? The web app is the quickest way to try Kumpas.</p>
          <a className="lp-link" href={WEB_APP_URL}>Open {WEB_APP_HOST}<IconArrowUpRight size={16} className="lp-nudge is-up" /></a>
        </div>
        <div className="lp-faq-list" data-reveal>
          {FAQS.map((f, i) => {
            const isOpen = open.has(i)
            return (
              <div key={f.q} className={`lp-faq-item${isOpen ? ' is-open' : ''}`}>
                <h3 className="lp-faq-q">
                  <button type="button" id={`lp-faq-q-${i}`} aria-expanded={isOpen} aria-controls={`lp-faq-a-${i}`} onClick={() => toggle(i)}>
                    <span>{f.q}</span>
                    <i aria-hidden="true"><IconPlus size={18} className="is-off" /><IconPlus size={18} className="is-on" /></i>
                  </button>
                </h3>
                <div className="lp-faq-panel" id={`lp-faq-a-${i}`} inert={!isOpen}>
                  <div className="lp-faq-clip"><div className="lp-faq-a">{f.a}</div></div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function Footer({ platform }: { platform: Platform }) {
  return (
    <footer className="lp-footer">
      <div className="lp-container">
        <div className="lp-footer-cta" data-reveal>
          <h2>Stop guessing.<br /><span>Start navigating.</span></h2>
          <div className="lp-hero-ctas">
            <PrimaryCtas platform={platform} />
          </div>
        </div>
        <div className="lp-footer-grid">
          <div className="lp-footer-brand">
            <a className="lp-brand" href="#top"><img src={logo} alt="" width={26} height={34} /><span>Kumpas</span></a>
            <p>Campus navigation for Isabela State University, Echague.</p>
          </div>
          <nav aria-label="Get Kumpas">
            <h3>Get Kumpas</h3>
            {platform !== 'ios' && <a href={APK_URL}>Android APK</a>}
            <a href={WEB_APP_URL}>Web app</a>
          </nav>
          <nav aria-label="Explore">
            <h3>Explore</h3>
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="#faq">FAQ</a>
          </nav>
          <nav aria-label="Staff">
            <h3>Staff</h3>
            <a href="#admins">For admins</a>
            <AdminLink />
          </nav>
        </div>
        <div className="lp-footer-base">
          <span>© {new Date().getFullYear()} Kumpas</span>
          <span>Map data © OpenStreetMap contributors</span>
        </div>
      </div>
    </footer>
  )
}

export function Landing() {
  const root = useRef<HTMLDivElement>(null)
  const platform = usePlatform()
  usePublicPageChrome()
  useReveal(root)
  return (
    <div ref={root} className="lp">
      <Nav />
      <main>
        <Hero platform={platform} />
        <Audience />
        <HowItWorks />
        <Showcase />
        <Features />
        <Download platform={platform} />
        <Admins />
        <Faq />
      </main>
      <Footer platform={platform} />
    </div>
  )
}
