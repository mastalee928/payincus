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
export interface MapLabelPlacement extends MapLabelPoint, MapLabelRect { slot: number; nodeX: number; nodeY: number }
export const MAX_MAP_LABEL_LEADER = 32

const overlaps = (a: MapLabelRect, b: MapLabelRect, gap = 3) =>
  a.x < b.x + b.width + gap && a.x + a.width + gap > b.x &&
  a.y < b.y + b.height + gap && a.y + a.height + gap > b.y

/** CSS-pixel layout; no DOM reads or changes to geographic/click targets. */
export function layoutMapLabels(points: MapLabelPoint[], width: number, height: number,
  measure: (text: string) => number, obstacles: MapLabelRect[] = [], previous = new Map<string, number>(), labelHeight = 20): MapLabelPlacement[] {
  const visible = points.filter(p => p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height)
  const nodes = visible.map(p => { const r = p.radius ?? 7; return { id: p.id, x: p.x - r, y: p.y - r, width: r * 2, height: r * 2 } })
  const placed: MapLabelPlacement[] = []
  const options: { point: MapLabelPoint; candidates: { label: MapLabelPlacement; cost: number }[] }[] = []
  for (const point of [...visible].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))) {
    if (point.priority < 0) continue
    const w = Math.ceil(measure(point.text)) + 2, h = labelHeight, gap = Math.max(15, (point.radius ?? 7) + 8)
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
    if (labelHeight >= 44) {
      // Small diagonal shifts fit adjacent cities around one cluster while every
      // label remains close; these do not introduce distant callout positions.
      for (const offset of [-h / 2 - 10, -h / 2 - 2, 0, h / 2 + 2, h / 2 + 10]) {
        for (const x of [point.x + 11, point.x - 11 - w, point.x + 23, point.x - 23 - w]) {
          slots.push([x, Math.max(8, Math.min(height - 8 - h, point.y - h / 2 + offset))])
        }
      }
      for (const offset of [-w / 2, 0, w / 2]) {
        for (const y of [point.y - 11 - h, point.y + 11]) {
          slots.push([Math.max(8, Math.min(width - 8 - w, point.x - w / 2 + offset)), y])
        }
      }
    }
    const cached = previous.get(point.id)
    const preferred = cached !== undefined && cached >= 0 && cached < slots.length ? cached : undefined
    const nearest = slots.map((_, i) => i)
    if (labelHeight >= 44) nearest.sort((a, b) => {
      const distance = (slot: number) => Math.hypot(slots[slot][0] + w / 2 - point.x, slots[slot][1] + h / 2 - point.y)
      return distance(a) - distance(b) || a - b
    })
    const order = preferred === undefined ? nearest : [preferred, ...nearest.filter(i => i !== preferred)]
    const candidates: { label: MapLabelPlacement; cost: number }[] = []
    for (const slot of order) {
      const [x, y] = slots[slot], rect = { x, y, width: w, height: h }
      // Measure to the visible 20px text, not its larger touch box. Dense labels yield;
      // a city name must never be moved across the map to fill an available gap.
      const textTop = y + (h - 20) / 2
      const leader = Math.hypot(Math.max(x, Math.min(x + w, point.x)) - point.x,
        Math.max(textTop, Math.min(textTop + 20, point.y)) - point.y)
      if (leader > MAX_MAP_LABEL_LEADER) continue
      if (x < 8 || y < 8 || x + w > width - 8 || y + h > height - 8) continue
      if (obstacles.some(r => overlaps(rect, r)) ||
        nodes.some(r => r.id !== point.id && overlaps(rect, r))) continue
      candidates.push({ label: { ...point, ...rect, slot, nodeX: point.x, nodeY: point.y }, cost: order.indexOf(slot) })
    }
    if (labelHeight < 44) {
      const candidate = candidates.find(({ label }) => !placed.some(r => overlaps(label, r)))
      if (candidate) placed.push(candidate.label)
      continue
    }
    if (candidates.length) options.push({ point, candidates })
  }
  // Solve nearby cities together. Independent cities must not exhaust the bounded
  // alternatives before a later dense cluster (e.g. Singapore) is even considered.
  const remaining = new Set(options)
  while (remaining.size) {
    const group = [remaining.values().next().value!]
    remaining.delete(group[0])
    for (let i = 0; i < group.length; i++) for (const other of remaining) {
      if (group[i].candidates.some(a => other.candidates.some(b => overlaps(a.label, b.label)))) {
        group.push(other); remaining.delete(other)
      }
    }
    const weight = (point: MapLabelPoint) => point.selected ? 10000 : point.priority >= 2 ? 1000 : 100
    let budget = 3000, requireAll = true, bestScore = -1, best: MapLabelPlacement[] = []
    const solve = (pending: typeof group, current: MapLabelPlacement[], score: number): boolean => {
      if (score > bestScore) { best = current; bestScore = score }
      if (!pending.length) return current.length === group.length
      if (--budget < 0 || score + pending.reduce((sum, item) => sum + weight(item.point), 0) <= bestScore) return false
      const choices = pending.map(item => ({ ...item, candidates: item.candidates.filter(({ label }) => !current.some(r => overlaps(label, r))) }))
        .sort((a, b) => Number(b.point.selected) - Number(a.point.selected) || a.candidates.length - b.candidates.length || b.point.priority - a.point.priority || a.point.id.localeCompare(b.point.id))
      const choice = choices[0], rest = choices.slice(1)
      if (requireAll && choices.some(item => !item.candidates.length)) return false
      const ranked = choice.candidates.map(candidate => {
        const counts = rest.map(item => item.candidates.filter(other => !overlaps(candidate.label, other.label)).length)
        return { ...candidate, blocked: counts.filter(n => n === 0).length, freedom: counts.reduce((sum, n) => sum + Math.log(n + 1), 0) }
      }).sort((a, b) => a.blocked - b.blocked || b.freedom - a.freedom || a.cost - b.cost)
      for (const { label } of ranked) if (solve(rest, [...current, label], score + weight(choice.point))) return true
      return !requireAll && solve(rest, current, score)
    }
    if (!solve(group, [], 0)) { requireAll = false; budget = 1000; solve(group, [], 0) }
    placed.push(...best)
  }
  return placed
}
