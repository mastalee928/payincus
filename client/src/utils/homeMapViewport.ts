export interface MapViewportPoint { x: number; y: number }
export interface MapViewport { zoom: number; pan: { x: number; y: number } }

/** Fit projected nodes, with CSS-pixel room for labels and the map's bottom controls. */
export function fitMapViewport(points: MapViewportPoint[], width: number, height: number): MapViewport {
  const usable = points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
  if (!usable.length || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { zoom: 1, pan: { x: 0, y: 0 } }
  }
  const scale = Math.min(width / 1440, height / 500)
  const minX = Math.min(...usable.map(point => point.x)), maxX = Math.max(...usable.map(point => point.x))
  const minY = Math.min(...usable.map(point => point.y)), maxY = Math.max(...usable.map(point => point.y))
  const side = Math.min(100, width * 0.12), top = Math.min(64, height * 0.15), bottom = Math.min(100, height * 0.24)
  const zoom = Math.max(1, Math.min(4,
    (width - side * 2) / (Math.max(1, maxX - minX) * scale),
    (height - top - bottom) / (Math.max(1, maxY - minY) * scale)))
  // Bounding-box midpoint is stable when stock/order changes or cities are densely clustered.
  const x = (720 - (minX + maxX) / 2) * zoom
  const y = (250 - (minY + maxY) / 2) * zoom + (top - bottom) / (2 * scale)
  const maxPanX = 720 * (zoom - 1), maxPanY = 250 * (zoom - 1)
  return { zoom, pan: { x: Math.max(-maxPanX, Math.min(maxPanX, x)), y: Math.max(-maxPanY, Math.min(maxPanY, y)) } }
}
