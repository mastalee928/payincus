import assert from 'node:assert/strict'
import { layoutMapLabels, type MapLabelPoint, type MapLabelRect } from '../../client/src/utils/homeMapLabels.js'
import { homeMapCityName } from '../../client/src/utils/homeMapCityNames.js'
import geography from '../../client/src/utils/home-region-geography.json' with { type: 'json' }

const measure = (text: string) => [...text].length * 9
const overlap = (a: MapLabelRect, b: MapLabelRect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
const point = (id: string, x: number, y: number, priority = 1): MapLabelPoint => ({ id, x, y, text: id, priority, selected: priority === 2 })
const points = [point('Sydney', 750, 250), point('Seoul', 610, 110), point('Chuncheon', 615, 105), point('inactive', 200, 120, -1)]
const normal = layoutMapLabels(points, 800, 300, measure)
assert.deepEqual(new Set(normal.map(p => p.id)), new Set(['Sydney', 'Seoul', 'Chuncheon']))
assert.deepEqual(layoutMapLabels([...points].reverse(), 800, 300, measure), normal, 'input order cannot reshuffle label priorities')
assert.equal(layoutMapLabels([point('hidden', 100, 100, -1)], 400, 300, measure).length, 0)
assert.equal(layoutMapLabels([point('outside', -10, 100)], 400, 300, measure).length, 0)
const dense = Array.from({ length: 45 }, (_, i) => point('city-' + i, 190 + (i % 5) * 4, 140 + Math.floor(i / 5) * 4))
dense.push(point('Selected', 205, 155, 3))
const obstacles = [{ x: 0, y: 230, width: 150, height: 70 }, { x: 350, y: 220, width: 50, height: 80 }]
const packed = layoutMapLabels(dense, 400, 300, measure, obstacles)
assert.ok(packed.some(p => p.id === 'Selected'), 'current focus wins a crowded layout')
assert.ok(packed.length < dense.length, 'dense labels yield instead of overlapping')
for (const set of [normal, packed]) for (const [i, label] of set.entries()) {
  for (const other of set.slice(i + 1)) assert.ok(!overlap(label, other))
  for (const obstacle of obstacles) if (set === packed) assert.ok(!overlap(label, obstacle))
}
for (const width of [768, 1440, 2160]) for (const zoom of [1, 1.8, 4]) {
  const scaled = points.map(p => ({ ...p, x: (p.x - 400) * zoom * width / 800 + width / 2, y: p.y * zoom, radius: 5 * zoom }))
  const labels = layoutMapLabels(scaled, width, 900, measure)
  for (const label of labels) {
    assert.equal(label.height, 20, 'label size is independent of zoom')
    assert.equal(label.width, Math.ceil(measure(label.text)) + 2)
    assert.ok(label.x >= 8 && label.x + label.width <= width - 8)
    assert.ok(label.y >= 8 && label.y + label.height <= 892)
  }
}
for (const city of geography) {
  assert.ok(city.name.includes(homeMapCityName(city.city, 'zh-CN')), city.city)
  assert.ok(city.nameZhTW.includes(homeMapCityName(city.city, 'zh-TW')), city.city)
  assert.equal(homeMapCityName(city.city, 'en'), city.city)
}
assert.equal(homeMapCityName('Unknown city', 'zh-CN'), 'Unknown city')
assert.equal(layoutMapLabels([point('A'.repeat(500), 200, 100)], 400, 300, measure).length, 0)
console.log('Homepage map labels: all-stock priority, dense collisions, bounds, obstacles, zoom-independent size and 45 authoritative translations passed')
