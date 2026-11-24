/**
 * Trackpad gesture plumbing shared by the 2D graph and the 3D view.
 *
 * macOS trackpads reach the browser as:
 *   - two-finger scroll  -> `wheel` with small deltaX/deltaY
 *   - pinch (Chrome, Firefox, Edge) -> `wheel` with ctrlKey = true
 *   - pinch (Safari)     -> non-standard `gesturestart/change/end` with `scale`
 * A mouse wheel arrives as a plain `wheel` too; hold ⌘/Ctrl to zoom with it.
 */

export interface GestureHandlers {
  /** factor > 1 zooms in; (x, y) is the cursor position inside the element, px */
  onZoom: (factor: number, x: number, y: number) => void
  /** two-finger scroll, px */
  onScroll: (dx: number, dy: number, shift: boolean) => void
}

interface SafariGestureEvent extends UIEvent {
  scale: number
  clientX: number
  clientY: number
}

/** Attach listeners; returns a cleanup function. Listeners are non-passive so we can stop page scroll/zoom. */
export function attachGestures(el: HTMLElement, h: GestureHandlers): () => void {
  const local = (e: { clientX: number; clientY: number }) => {
    const r = el.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top] as const
  }

  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const scale = e.deltaMode === 1 ? 16 : 1 // Firefox line mode
    if (e.ctrlKey || e.metaKey) {
      const [x, y] = local(e)
      h.onZoom(Math.exp((-e.deltaY * scale) / 100), x, y)
    } else {
      h.onScroll(e.deltaX * scale, e.deltaY * scale, e.shiftKey)
    }
  }

  let lastScale = 1
  const onGestureStart = (e: Event) => {
    e.preventDefault()
    lastScale = 1
  }
  const onGestureChange = (e: Event) => {
    e.preventDefault()
    const g = e as SafariGestureEvent
    const [x, y] = local(g)
    h.onZoom(g.scale / lastScale, x, y)
    lastScale = g.scale
  }

  el.addEventListener('wheel', onWheel, { passive: false })
  el.addEventListener('gesturestart', onGestureStart, { passive: false })
  el.addEventListener('gesturechange', onGestureChange, { passive: false })
  return () => {
    el.removeEventListener('wheel', onWheel)
    el.removeEventListener('gesturestart', onGestureStart)
    el.removeEventListener('gesturechange', onGestureChange)
  }
}
