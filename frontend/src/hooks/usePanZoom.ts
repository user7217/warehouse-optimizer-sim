import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { attachGestures } from './gestures'

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** x, y: world coords at the element's top-left corner. k: pixels per world unit. */
interface View {
  x: number
  y: number
  k: number
}

const MIN_K = 0.05
const MAX_K = 20
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k))

/**
 * Pan/zoom for an SVG, tuned for trackpads:
 * pinch = zoom at cursor, two-finger scroll = pan, drag = pan, double-click = fit.
 * The viewBox always matches the element's aspect ratio, so 1 screen px = 1/k world units exactly.
 */
export function usePanZoom(ref: RefObject<SVGSVGElement | null>, content: Bounds) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 })
  const userMoved = useRef(false) // true once the user pans/zooms; stops auto-fit

  const fit = useCallback(() => {
    userMoved.current = false
    if (!size.w || !size.h) return
    const cw = content.maxX - content.minX
    const ch = content.maxY - content.minY
    const k = clampK(Math.min(size.w / cw, size.h / ch))
    setView({ k, x: content.minX - (size.w / k - cw) / 2, y: content.minY - (size.h / k - ch) / 2 })
  }, [size, content])

  const zoomAt = useCallback((factor: number, px: number, py: number) => {
    userMoved.current = true
    setView((v) => {
      const k = clampK(v.k * factor)
      return { k, x: v.x + px / v.k - px / k, y: v.y + py / v.k - py / k }
    })
  }, [])

  const zoomCenter = useCallback((factor: number) => zoomAt(factor, size.w / 2, size.h / 2), [zoomAt, size])

  // Track element size.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])

  // Stay fitted (through panel resizes, content changes) until the user pans or zooms.
  useEffect(() => {
    userMoved.current = false
  }, [content])
  useEffect(() => {
    if (!userMoved.current) fit()
  }, [fit])

  // Trackpad gestures.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    return attachGestures(el as unknown as HTMLElement, {
      onZoom: zoomAt,
      onScroll: (dx, dy) => {
        userMoved.current = true
        setView((v) => ({ ...v, x: v.x + dx / v.k, y: v.y + dy / v.k }))
      },
    })
  }, [ref, zoomAt])

  // Drag to pan (click on empty space; clicks on robots still work because we only pan after movement).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let last: { x: number; y: number } | null = null
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      last = { x: e.clientX, y: e.clientY }
    }
    const move = (e: PointerEvent) => {
      if (!last) return
      const dx = e.clientX - last.x
      const dy = e.clientY - last.y
      if (!el.hasPointerCapture(e.pointerId)) {
        if (Math.hypot(dx, dy) < 3) return // treat tiny moves as a click
        el.setPointerCapture(e.pointerId)
        el.classList.add('panning')
      }
      last = { x: e.clientX, y: e.clientY }
      userMoved.current = true
      setView((v) => ({ ...v, x: v.x - dx / v.k, y: v.y - dy / v.k }))
    }
    const up = (e: PointerEvent) => {
      last = null
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      el.classList.remove('panning')
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('dblclick', fit)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('dblclick', fit)
    }
  }, [ref, fit])

  const viewBox = size.w ? `${view.x} ${view.y} ${size.w / view.k} ${size.h / view.k}` : undefined
  return { viewBox, zoom: view.k, fit, zoomCenter }
}
