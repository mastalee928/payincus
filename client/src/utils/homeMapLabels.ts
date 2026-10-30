export interface MapLabelPoint {
  id: string
  x: number
  y: number
  text: string
  priority: number
  selected: boolean
  radius?: number
}
export interface MapLabelRect { x: number; y: number; width: number; height: number }
export interface MapLabelPlacement extends MapLabelPoint, MapLabelRect { slot: number }

const overlaps = (a: MapLabelRect, b: MapLabelRect, gap = 3) =>
  a.x < b.x + b.width + gap && a.x + a.width + gap > b.x &&
  a.y < b.y + b.height + gap && a.y + a.height + gap > b.y

/** CSS-pixel layout; no DOM reads or changes to geographic/click targets. */
export function layoutMapLabels(points: MapLabelPoint[], width: number, height: number,
  measure: (text: string) => number, obstacles: MapLabelRect[] = [], previous = new Map<string, number>()): MapLabelPlacement[] {
  const visible = points.filter(p => p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height)
  const nodes = visible.map(p => { const r = p.radius ?? 7; return { id: p.id, x: p.x - r, y: p.y - r, width: r * 2, height: r * 2 } })
  const placed: MapLabelPlacement[] = []
  for (const point of [...visible].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))) {
    if (point.priority < 0) continue
    const w = Math.ceil(measure(point.text)) + 2, h = 20, gap = Math.max(15, (point.radius ?? 7) + 8)
    const slots = [
      [point.x + gap, point.y - h / 2], [point.x - gap - w, point.y - h / 2],
      [point.x - w / 2, point.y - gap - h], [point.x - w / 2, point.y + gap],
      [point.x + gap, point.y - gap - h], [point.x - gap - w, point.y - gap - h],
      [point.x + gap, point.y + gap], [point.x - gap - w, point.y + gap],
      [point.x - w / 2, point.y - gap - h - 22], [point.x - w / 2, point.y + gap + 22],
      [point.x - gap - w - 22, point.y - h / 2], [point.x + gap + 22, point.y - h / 2],
      [point.x - gap - w, point.y - gap - h - 22], [point.x + gap, point.y - gap - h - 22],
      [point.x - gap - w, point.y + gap + 22], [point.x + gap, point.y + gap + 22]
    ]
    const preferred = previous.get(point.id)
    const order = preferred === undefined ? slots.map((_, i) => i) : [preferred, ...slots.map((_, i) => i).filter(i => i !== preferred)]
    for (const slot of order) {
      const [x, y] = slots[slot], rect = { x, y, width: w, height: h }
      if (x < 8 || y < 8 || x + w > width - 8 || y + h > height - 8) continue
      if (obstacles.some(r => overlaps(rect, r)) || placed.some(r => overlaps(rect, r)) ||
        nodes.some(r => r.id !== point.id && overlaps(rect, r))) continue
      placed.push({ ...point, ...rect, slot })
      break
    }
  }
  return placed
}
