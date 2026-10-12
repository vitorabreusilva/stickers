import { RESTING_LIGHT, type Light } from './effects'

/**
 * Moves the light that foil effects reflect, so their sheen shifts like the real thing: with the
 * phone's tilt, with the pointer on desktop, and otherwise in a slow idle drift. Everything on
 * screen shares one light, published as the --fx-x and --fx-y custom properties (-1…1).
 */

const clamp = (v: number) => Math.min(1, Math.max(-1, v))

// How many degrees of tilt sweep the light from the middle to an edge.
const TILT_RANGE = 22
// How quickly "how you hold the phone" catches up with the current angle, per reading.
const TILT_SETTLE = 0.004

/**
 * Turns orientation readings into a light. Tilt is measured from how the phone is usually held,
 * which slowly follows the current angle so the sheen recenters after a while.
 */
export function createTiltTracker() {
  let base: { beta: number; gamma: number } | null = null
  return (beta: number, gamma: number, screenAngle = 0): Light => {
    base ??= { beta, gamma }
    // Beta wraps at ±180° when the phone tips over.
    const dBeta = ((((beta - base.beta + 180) % 360) + 360) % 360) - 180
    const dGamma = gamma - base.gamma
    base.beta += dBeta * TILT_SETTLE
    base.gamma += dGamma * TILT_SETTLE
    // Tilting the right edge away moves the reflection left, as on a real card.
    let x = -dGamma / TILT_RANGE
    let y = -dBeta / TILT_RANGE
    // The sensor axes are fixed to the device; turn them to match the screen.
    switch (((screenAngle % 360) + 360) % 360) {
      case 90:
        ;[x, y] = [-y, x]
        break
      case 180:
        ;[x, y] = [-x, -y]
        break
      case 270:
        ;[x, y] = [y, -x]
        break
    }
    return { x: clamp(x), y: clamp(y) }
  }
}

/** A slow figure-of-eight around the resting light, `t` in seconds. */
export function idleLight(t: number): Light {
  return {
    x: clamp(RESTING_LIGHT.x * 0.4 + 0.6 * Math.sin(t * 0.45)),
    y: clamp(RESTING_LIGHT.y * 0.4 + 0.45 * Math.sin(t * 0.7 + 1)),
  }
}

/** Pointer position on screen as a light. */
export const pointerLight = (x: number, y: number, width: number, height: number): Light => ({
  x: clamp((x / Math.max(1, width)) * 2 - 1),
  y: clamp((y / Math.max(1, height)) * 2 - 1),
})

// The live light, shared by every sticker on screen.

type TiltState = 'off' | 'listening' | 'denied'

// Touches and tilt readings count as "recent" this long; a mouse keeps the light until it leaves.
const INPUT_HOLD = 2500

let watchers = 0
let idlers = 0
let frame = 0
let current: Light = { ...RESTING_LIGHT }
let input: { light: Light; at: number; hold: boolean } | null = null
let tilt: TiltState = 'off'
let track = createTiltTracker()
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

function publish(light: Light) {
  const style = document.documentElement.style
  style.setProperty('--fx-x', light.x.toFixed(3))
  style.setProperty('--fx-y', light.y.toFixed(3))
}

function tick(now: number) {
  frame = 0
  const recent = input && (input.hold || now - input.at < INPUT_HOLD)
  const target = recent ? input!.light : idlers > 0 ? idleLight(now / 1000) : RESTING_LIGHT
  // Ease towards the target: smooths jittery sensors and makes the sheen feel weighty.
  const next = { x: current.x + (target.x - current.x) * 0.12, y: current.y + (target.y - current.y) * 0.12 }
  const moved = Math.abs(next.x - current.x) + Math.abs(next.y - current.y) > 0.0005
  if (moved) {
    current = next
    publish(current)
  }
  if (watchers > 0 && (moved || recent || idlers > 0)) frame = requestAnimationFrame(tick)
}

const wake = () => {
  if (!frame && watchers > 0) frame = requestAnimationFrame(tick)
}

function onPointer(e: PointerEvent) {
  input = {
    light: pointerLight(e.clientX, e.clientY, innerWidth, innerHeight),
    at: performance.now(),
    hold: e.pointerType === 'mouse',
  }
  wake()
}

function onPointerOut(e: PointerEvent) {
  // The mouse left the window.
  if (e.pointerType === 'mouse' && !e.relatedTarget && input) input.hold = false
}

function onOrientation(e: DeviceOrientationEvent) {
  if (e.beta == null || e.gamma == null) return
  input = { light: track(e.beta, e.gamma, screen.orientation?.angle ?? 0), at: performance.now(), hold: false }
  wake()
}

function listenToTilt() {
  if (tilt !== 'off' || typeof DeviceOrientationEvent === 'undefined') return
  tilt = 'listening'
  track = createTiltTracker()
  addEventListener('deviceorientation', onOrientation)
}

type PermissionRequest = () => Promise<'granted' | 'denied'>
const permissionRequest = () =>
  (globalThis.DeviceOrientationEvent as unknown as { requestPermission?: PermissionRequest } | undefined)
    ?.requestPermission

/**
 * Starts following the phone's tilt. iOS asks the user first, which only works from a tap, so
 * call this from a click handler; elsewhere tilt starts on its own and this does nothing.
 */
export function enableTilt() {
  const request = permissionRequest()
  if (!request || tilt !== 'off' || reducedMotion()) return
  request()
    .then((answer) => {
      if (answer === 'granted') listenToTilt()
      else tilt = 'denied'
    })
    .catch(() => {
      // Not from a tap, or not allowed here (plain http). The idle drift carries on.
    })
}

function start() {
  if (reducedMotion()) return
  addEventListener('pointermove', onPointer, { passive: true })
  addEventListener('pointerdown', onPointer, { passive: true })
  document.addEventListener('pointerout', onPointerOut)
  // iOS needs a tap to say yes first; see enableTilt.
  if (!permissionRequest()) listenToTilt()
  wake()
}

function stop() {
  removeEventListener('pointermove', onPointer)
  removeEventListener('pointerdown', onPointer)
  document.removeEventListener('pointerout', onPointerOut)
  if (tilt === 'listening') {
    removeEventListener('deviceorientation', onOrientation)
    tilt = 'off'
  }
  if (frame) cancelAnimationFrame(frame)
  frame = 0
  input = null
}

/**
 * Keeps the light moving while something shows a foil effect. With `idle`, it also drifts on its
 * own when nothing else moves it; use that for the sticker in focus, not for whole grids.
 * Returns a function that stops watching.
 */
export function watchLight(idle: boolean): () => void {
  if (watchers++ === 0) start()
  if (idle) idlers++
  wake()
  return () => {
    if (idle) idlers--
    if (--watchers === 0) stop()
    else wake()
  }
}
