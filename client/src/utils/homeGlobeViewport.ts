import { geoBounds, geoOrthographic } from 'd3-geo'

export const MAX_GLOBE_ZOOM = 6

/** Fit the actual spherical projection, reserving CSS pixels for city names and touch controls. */
export function fitGlobeViewport(locations: [number, number][], width: number, height: number) {
  const valid = locations.filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90)
  if (!valid.length || width <= 0 || height <= 0) return null
  const [[west, south], [east, north]] = geoBounds({ type: 'MultiPoint', coordinates: valid })
  const longitude = west + ((east - west + 360) % 360) / 2
  const rotation: [number, number, number] = [-longitude, -(south + north) / 2, 0]
  const projection = geoOrthographic().translate([0, 0]).scale(1).rotate(rotation)
  const projected = valid.map(point => projection(point)!)
  const extentX = Math.max(...projected.map(point => Math.abs(point[0])), 0.01)
  const extentY = Math.max(...projected.map(point => Math.abs(point[1])), 0.01)
  const scale = Math.min(width, height) * 0.44
  const zoom = Math.min(MAX_GLOBE_ZOOM, Math.max(1, Math.min(
    Math.max(1, width / 2 - 64) / (extentX * scale),
    Math.max(1, height / 2 - 60) / (extentY * scale)
  )))
  return { rotation, zoom }
}
