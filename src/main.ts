import './style.css'
import * as THREE from 'three'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

// ── DOM refs ──────────────────────────────────────────────────────────────────

const canvas        = document.getElementById('bg')             as HTMLCanvasElement
const textContainer = document.getElementById('text-container') as HTMLDivElement
const navbar        = document.getElementById('navbar')         as HTMLElement
const scrollHint    = document.getElementById('scroll-hint')    as HTMLElement
const enterOverlay  = document.getElementById('enter-overlay')  as HTMLDivElement
const enterBtn      = document.getElementById('enter-btn')      as HTMLButtonElement
const muteBtn       = document.getElementById('mute-btn')       as HTMLButtonElement

// ── Audio System ──────────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null
let masterGain: GainNode | null   = null
let isMuted = false

function initAudio(): void {
  audioCtx   = new AudioContext()
  masterGain = audioCtx.createGain()
  masterGain.gain.value = 1
  masterGain.connect(audioCtx.destination)
}

function startAmbientHum(): void {
  if (!audioCtx || !masterGain) return

  const humGain = audioCtx.createGain()
  humGain.gain.setValueAtTime(0, audioCtx.currentTime)
  humGain.gain.linearRampToValueAtTime(0.10, audioCtx.currentTime + 2.5)

  // Slow LFO for barely-perceptible pitch drift — makes the drone feel alive
  const lfo     = audioCtx.createOscillator()
  const lfoGain = audioCtx.createGain()
  lfo.type            = 'sine'
  lfo.frequency.value = 0.12
  lfoGain.gain.value  = 1.2
  lfo.connect(lfoGain)
  lfo.start()

  // Three detuned sine oscillators — deep space drone
  ;[40, 55, 80].forEach((freq) => {
    const osc = audioCtx!.createOscillator()
    osc.type            = 'sine'
    osc.frequency.value = freq
    lfoGain.connect(osc.frequency)
    osc.connect(humGain)
    osc.start()
  })

  // Short feedback delay for spatial depth
  const delay         = audioCtx.createDelay(2.0)
  const delayFeedback = audioCtx.createGain()
  const delayWet      = audioCtx.createGain()
  delay.delayTime.value    = 0.9
  delayFeedback.gain.value = 0.28
  delayWet.gain.value      = 0.25

  humGain.connect(delay)
  delay.connect(delayFeedback)
  delayFeedback.connect(delay)
  delay.connect(delayWet)
  delayWet.connect(masterGain)
  humGain.connect(masterGain)
}

function playWhoosh(intensity = 1): void {
  if (!audioCtx || !masterGain) return

  const duration  = 1.3
  const buf       = audioCtx.createBuffer(1, Math.ceil(audioCtx.sampleRate * duration), audioCtx.sampleRate)
  const data      = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

  const src    = audioCtx.createBufferSource()
  src.buffer   = buf

  const filter         = audioCtx.createBiquadFilter()
  filter.type          = 'bandpass'
  filter.Q.value       = 2.2
  filter.frequency.setValueAtTime(600,                    audioCtx.currentTime)
  filter.frequency.linearRampToValueAtTime(2800 * intensity, audioCtx.currentTime + 0.35)
  filter.frequency.linearRampToValueAtTime(300,           audioCtx.currentTime + duration)

  const gain = audioCtx.createGain()
  gain.gain.setValueAtTime(0,                      audioCtx.currentTime)
  gain.gain.linearRampToValueAtTime(0.14 * intensity, audioCtx.currentTime + 0.12)
  gain.gain.linearRampToValueAtTime(0,             audioCtx.currentTime + duration)

  src.connect(filter)
  filter.connect(gain)
  gain.connect(masterGain)
  src.start()
}

function playShimmer(): void {
  if (!audioCtx || !masterGain) return

  // Cascading C-major arpeggio — C5 → E5 → G5 → C6 → E6
  ;[523.25, 659.25, 783.99, 1046.50, 1318.51].forEach((freq, i) => {
    const osc  = audioCtx!.createOscillator()
    const gain = audioCtx!.createGain()
    const t    = audioCtx!.currentTime + i * 0.11

    osc.type            = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0,    t)
    gain.gain.linearRampToValueAtTime(0.07, t + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 3.5)

    osc.connect(gain)
    gain.connect(masterGain!)
    osc.start(t)
    osc.stop(t + 3.5)
  })

  // Airy high-frequency transient
  const airBuf  = audioCtx.createBuffer(1, Math.ceil(audioCtx.sampleRate * 0.4), audioCtx.sampleRate)
  const airData = airBuf.getChannelData(0)
  for (let i = 0; i < airData.length; i++) airData[i] = Math.random() * 2 - 1

  const airSrc  = audioCtx.createBufferSource()
  airSrc.buffer = airBuf

  const airFilter         = audioCtx.createBiquadFilter()
  airFilter.type          = 'highpass'
  airFilter.frequency.value = 5000

  const airGain = audioCtx.createGain()
  airGain.gain.setValueAtTime(0.06, audioCtx.currentTime)
  airGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4)

  airSrc.connect(airFilter)
  airFilter.connect(airGain)
  airGain.connect(masterGain)
  airSrc.start()
}

// ── Scene / Camera / Renderer ─────────────────────────────────────────────────

const scene = new THREE.Scene()

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
)
camera.position.z = 5

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setClearColor(0x000000, 1)

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

// ── Viewport helper ───────────────────────────────────────────────────────────

function getViewport(atZ = 0) {
  const dist = camera.position.z - atZ
  const vFovRad = (camera.fov * Math.PI) / 180
  const height = 2 * Math.tan(vFovRad / 2) * dist
  return { width: height * camera.aspect, height }
}

// ── Stars ─────────────────────────────────────────────────────────────────────

function createStarTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 32; c.height = 32
  const ctx = c.getContext('2d')!
  const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
  grad.addColorStop(0,   'rgba(255,255,255,1)')
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)')
  grad.addColorStop(1,   'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 32, 32)
  return new THREE.CanvasTexture(c)
}

const STAR_COUNT = 3800
const starPositions = new Float32Array(STAR_COUNT * 3)
for (let i = 0; i < STAR_COUNT; i++) {
  starPositions[i * 3 + 0] = (Math.random() - 0.5) * 20
  starPositions[i * 3 + 1] = (Math.random() - 0.5) * 20
  starPositions[i * 3 + 2] = -Math.random() * 195 - 5
}

const starGeo = new THREE.BufferGeometry()
starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))

const starMat = new THREE.PointsMaterial({
  map: createStarTexture(),
  color: 0xffffff,
  size: 0.10,
  sizeAttenuation: true,
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
})

scene.add(new THREE.Points(starGeo, starMat))

// ── Warp velocity state ────────────────────────────────────────────────────────

const AMBIENT_SPEED  = 0.05
const MAX_WARP_SPEED = 0.45
let starVelocity = 0.0
const warpProxy = { ambient: 0.0, boost: 0.0 }

// ── Orb (multi-layer glow sprites — pure white) ────────────────────────────────

function makeGlowTexture(
  size: number,
  stops: Array<[number, string]>
): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const r = size / 2
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r)
  stops.forEach(([pos, color]) => grad.addColorStop(pos, color))
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(c)
}

function makeSprite(texture: THREE.CanvasTexture, scale: number): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: texture,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(scale, scale, 1)
  return sprite
}

const orbGroup = new THREE.Group()
orbGroup.visible = false
scene.add(orbGroup)

orbGroup.add(
  makeSprite(
    makeGlowTexture(256, [
      [0,    'rgba(255,255,255,0.50)'],
      [0.45, 'rgba(255,255,255,0.12)'],
      [1,    'rgba(0,0,0,0)'],
    ]),
    4.5
  )
)

orbGroup.add(
  makeSprite(
    makeGlowTexture(128, [
      [0,    'rgba(255,255,255,0.92)'],
      [0.35, 'rgba(255,255,255,0.42)'],
      [1,    'rgba(0,0,0,0)'],
    ]),
    1.9
  )
)

orbGroup.add(
  makeSprite(
    makeGlowTexture(64, [
      [0,    'rgba(255,255,255,1)'],
      [0.25, 'rgba(255,255,255,0.8)'],
      [1,    'rgba(0,0,0,0)'],
    ]),
    0.45
  )
)

// ── Render loop ───────────────────────────────────────────────────────────────

const pos = starGeo.attributes.position as THREE.BufferAttribute

function tick() {
  requestAnimationFrame(tick)

  const targetV = warpProxy.ambient + warpProxy.boost
  starVelocity += (targetV - starVelocity) * 0.04
  warpProxy.boost *= 0.88

  const speedRatio = Math.min(starVelocity / MAX_WARP_SPEED, 1)
  starMat.size = 0.10 + speedRatio * 0.30

  const arr = pos.array as Float32Array
  for (let i = 0; i < STAR_COUNT; i++) {
    arr[i * 3 + 2] += starVelocity
    if (arr[i * 3 + 2] > 4.5) {
      arr[i * 3 + 0] = (Math.random() - 0.5) * 20
      arr[i * 3 + 1] = (Math.random() - 0.5) * 20
      arr[i * 3 + 2] = -200
    }
  }
  pos.needsUpdate = true

  renderer.render(scene, camera)
}
tick()

// ── Experience (starts after Enter button click) ──────────────────────────────

function startExperience(): void {

// ── GSAP master timeline ──────────────────────────────────────────────────────

const vp = getViewport(0)
const halfW = vp.width / 2
const halfH = vp.height / 2

const SWEEP_LEFT  = -(halfW + 2)
const SWEEP_RIGHT =   halfW + 2

// ── Wander config: 2 centre-area hops + 1 deliberate approach to SWEEP_LEFT ──
// Durations shorten each hop to build kinetic momentum; the final ease is
// power2.in (accelerates into the destination) so the orb "commits" to the left.

const RANDOM_HOPS   = 2
const WANDER_GAP    = 0.08
const HOP_DURATIONS = [1.10, 0.80, 0.95]  // explore → quicken → committed dash
const HOP_EASES     = ['power2.inOut', 'power2.inOut', 'power2.in']
const TOTAL_WANDER  =
  HOP_DURATIONS.reduce((s, d) => s + d, 0) + RANDOM_HOPS * WANDER_GAP  // 3.01 s

const START_SCALE = 0.08
const END_SCALE   = 1.0

// Random hops stay in the central 55 % of the viewport — the "orbit/dance" zone
const randomHops = Array.from({ length: RANDOM_HOPS }, () => ({
  x: (Math.random() - 0.5) * halfW * 1.1,
  y: (Math.random() - 0.5) * halfH * 1.1,
})).map((p) => ({
  x: Math.max(-halfW * 0.55, Math.min(halfW * 0.55, p.x)),
  y: Math.max(-halfH * 0.55, Math.min(halfH * 0.55, p.y)),
}))

// The LAST waypoint IS the sweep start — eliminates the separate repositioning step
const wanderSpots = [...randomHops, { x: SWEEP_LEFT, y: 0 }]

// ── Build intro timeline ──────────────────────────────────────────────────────

const tl = gsap.timeline({ delay: 0.4 })

// 1. Ambient hum starts + stars fade in + warp ramps up together
tl.call(() => startAmbientHum())

tl.to(starMat, {
  opacity: 0.92,
  duration: 2.5,
  ease: 'power1.inOut',
})
tl.to(warpProxy, {
  ambient: AMBIENT_SPEED,
  duration: 2.5,
  ease: 'power1.inOut',
}, '<')

// 2. Spawn orb at START_SCALE (tiny pin-point)
tl.call(() => { orbGroup.visible = true })
tl.to(
  orbGroup.scale,
  { x: START_SCALE, y: START_SCALE, z: START_SCALE, duration: 0.55, ease: 'back.out(2.5)' },
  '<'
)

// 3. Wander → last hop lands on SWEEP_LEFT (no separate repositioning step) ──────
tl.addLabel('wanderStart')

wanderSpots.forEach((spot, i) => {
  tl.to(orbGroup.position, {
    x: spot.x,
    y: spot.y,
    duration: HOP_DURATIONS[i],
    ease: HOP_EASES[i],
    onStart: () => playWhoosh(0.5 + i * 0.18),
  }, i === 0 ? 'wanderStart' : `>+=${WANDER_GAP}`)
})

// Concurrent scale growth — tiny pin-point → full glow over the whole wander window
tl.to(
  orbGroup.scale,
  { x: END_SCALE, y: END_SCALE, z: END_SCALE, duration: TOTAL_WANDER, ease: 'power1.inOut' },
  'wanderStart'
)
// '>' now resolves to wanderStart + TOTAL_WANDER — sweep follows immediately

// 5. Sweep right + reveal text via clip-path ───────────────────────────────────
const sweep = { t: 0 }

tl.to(sweep, {
  t: 1,
  duration: 2.6,
  ease: 'power1.inOut',

  onStart() { playShimmer() },

  onUpdate() {
    const p = sweep.t
    const newX = SWEEP_LEFT + (SWEEP_RIGHT - SWEEP_LEFT) * p
    orbGroup.position.x = newX

    // Orb world-X → percentage across the full viewport [0 … 100]
    const pct = ((newX - (-halfW)) / (halfW * 2)) * 100

    // 3 % feather zone: glow bleeds naturally past the reveal edge instead
    // of being hard-cut (which caused the visible "glowing rectangle" box)
    const feather = 3
    const lStop = Math.max(0,   pct - feather).toFixed(2)
    const rStop = Math.min(100, Math.max(0, pct + feather)).toFixed(2)
    const mask  = `linear-gradient(to right, white 0%, white ${lStop}%, transparent ${rStop}%, transparent 100%)`

    textContainer.style.setProperty('-webkit-mask-image', mask)
    textContainer.style.setProperty('mask-image', mask)
  },

  onComplete() {
    // Remove mask entirely so the text is permanently and fully visible
    textContainer.style.setProperty('-webkit-mask-image', 'none')
    textContainer.style.setProperty('mask-image', 'none')
  },
})

// 6. Orb shrinks out
tl.to(
  orbGroup.scale,
  { x: 0, y: 0, z: 0, duration: 0.9, ease: 'power2.in' },
  '+=0.45'
)

// 7. Finish: unlock scroll, reveal nav + scroll hint, wire up scroll effects ────
tl.call(() => {
  orbGroup.visible = false
  textContainer.classList.add('text-breathe')

  // Unlock scroll
  document.body.style.overflow = 'auto'

  // Let ScrollTrigger measure correct positions after overflow change
  ScrollTrigger.refresh()

  // Fade in the navigation bar
  navbar.classList.add('visible')
  gsap.to(navbar, { opacity: 1, duration: 0.9, ease: 'power1.out' })

  // Fade in the scroll hint with a small delay
  gsap.to(scrollHint, { opacity: 1, duration: 0.7, delay: 0.4, ease: 'power1.out' })

  // Set up all scroll-driven effects
  setupScrollEffects()
})

} // ── end startExperience ─────────────────────────────────────────────────────

// ── Scroll-driven effects (registered only after intro completes) ─────────────

function setupScrollEffects() {
  // Canvas dims as the user scrolls into the content sections
  gsap.to(canvas, {
    opacity: 0.12,
    ease: 'none',
    scrollTrigger: {
      trigger: '#services',
      start: 'top 85%',
      end: 'top 15%',
      scrub: 1.5,
    },
  })

  // Hero overlay fades out as content scrolls into view
  gsap.to('#overlay', {
    opacity: 0,
    ease: 'none',
    scrollTrigger: {
      trigger: '#services',
      start: 'top 95%',
      end: 'top 55%',
      scrub: 1,
    },
  })

  // Scroll hint disappears as soon as the user starts scrolling
  gsap.to(scrollHint, {
    opacity: 0,
    ease: 'none',
    scrollTrigger: {
      trigger: '#services',
      start: 'top 100%',
      end: 'top 85%',
      scrub: true,
    },
  })

  // Scroll velocity drives warp boost
  ScrollTrigger.create({
    trigger: 'body',
    start: 'top top',
    end: 'bottom bottom',
    onUpdate(self) {
      const v = Math.abs(self.getVelocity())
      warpProxy.boost = Math.min(v / 1200, 1) * (MAX_WARP_SPEED - AMBIENT_SPEED)
    },
  })

  // Section elements fade + rise into view on scroll
  const fadeTargets = gsap.utils.toArray<HTMLElement>(
    '.section-label, .section-title, .section-sub, .service-card, .about-text, .stat, .contact-main'
  )

  fadeTargets.forEach((el) => {
    gsap.from(el, {
      y: 28,
      opacity: 0,
      duration: 1,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: el,
        start: 'top 88%',
        toggleActions: 'play none none none',
      },
    })
  })
}

// ── Enter button ──────────────────────────────────────────────────────────────

enterBtn.addEventListener('click', () => {
  initAudio()

  gsap.to(enterOverlay, {
    opacity: 0,
    duration: 1.2,
    ease: 'power2.inOut',
    onComplete: () => { enterOverlay.style.display = 'none' },
  })

  startExperience()
})

// ── Mute toggle ───────────────────────────────────────────────────────────────

muteBtn.addEventListener('click', () => {
  isMuted = !isMuted
  if (masterGain && audioCtx) {
    masterGain.gain.setTargetAtTime(isMuted ? 0 : 1, audioCtx.currentTime, 0.08)
  }
  muteBtn.classList.toggle('muted', isMuted)
})
