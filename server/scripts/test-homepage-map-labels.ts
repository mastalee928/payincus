import assert from 'node:assert/strict'
import { layoutMapLabels, MAX_MAP_LABEL_LEADER, type MapLabelPoint, type MapLabelRect } from '../../client/src/utils/homeMapLabels.js'
import { homeMapCityName, homeMapRegionLabel } from '../../client/src/utils/homeMapCityNames.js'
import { fitMapViewport } from '../../client/src/utils/homeMapViewport.js'
import { fitGlobeViewport, MAX_GLOBE_ZOOM } from '../../client/src/utils/homeGlobeViewport.js'
import { buildAtlasRegions } from '../../client/src/utils/homeRegionAtlas.js'
import geography from '../../client/src/utils/home-region-geography.json' with { type: 'json' }

const measure = (text: string) => [...text].length * 9
const overlap = (a: MapLabelRect, b: MapLabelRect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
const point = (id: string, x: number, y: number, priority = 1): MapLabelPoint => ({ id, x, y, text: id, priority, selected: priority === 2 })
const points = [point('Sydney', 750, 250), point('Seoul', 610, 110), point('Chuncheon', 615, 105), point('inactive', 200, 120, -1)]
const normal = layoutMapLabels(points, 800, 300, measure)
assert.deepEqual(new Set(normal.map(p => p.id)), new Set(['Sydney', 'Seoul', 'Chuncheon']))
assert.deepEqual(layoutMapLabels([...points].reverse(), 800, 300, measure), normal, 'input order cannot reshuffle label priorities')
for (const label of normal) {
  const source = points.find(point => point.id === label.id)!
  assert.equal(label.nodeX, source.x, 'leader keeps the original node x after label placement')
  assert.equal(label.nodeY, source.y, 'leader keeps the original node y after label placement')
}
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

const atlas = buildAtlasRegions([])
for (const [width, height] of [[768, 500 * 768 / 1440], [1660, 500 * 1660 / 1440], [2160, 750], [390, 240]]) {
  const zooms = new Set<number>()
  for (const continent of new Set(atlas.map(region => region.continent))) {
    const points = atlas.filter(region => region.continent === continent).map(region => ({ x: region.displayX!, y: region.displayY! }))
    const view = fitMapViewport(points, width, height)
    assert.deepEqual(view, fitMapViewport([...points].reverse(), width, height), 'catalog order must not alter framing')
    assert.deepEqual(view, fitMapViewport([...points, ...points.slice(0, 3)], width, height), 'dense nodes must not bias the center')
    assert.ok(view.zoom > 1 && view.zoom <= 4)
    zooms.add(view.zoom)
    const scale = Math.min(width / 1440, height / 500)
    for (const point of points) {
      const x = width / 2 + ((point.x - 720) * view.zoom + view.pan.x) * scale
      const y = height / 2 + ((point.y - 250) * view.zoom + view.pan.y) * scale
      assert.ok(x >= 12 && x <= width - 12 && y >= 12 && y <= height - 12, `${continent} node clipped at ${width}: ${x},${y}`)
    }
  }
  assert.ok(zooms.size >= 3, 'continent framing must adapt to geographic span')
}
for (const points of [[], [{ x: NaN, y: Infinity }]]) assert.deepEqual(fitMapViewport(points, 1440, 500), { zoom: 1, pan: { x: 0, y: 0 } })
assert.deepEqual(fitMapViewport([{ x: 740, y: 150 }], 0, 0), { zoom: 1, pan: { x: 0, y: 0 } })
assert.equal(fitMapViewport([{ x: 740, y: 150 }], 1440, 500).zoom, 4, 'single location is bounded')
console.log('Homepage continent framing: five geographic groups, responsive bounds, stable center and invalid/single-point fallback passed')

for (const [width, height] of [[320, 340], [390, 388], [465, 391], [767, 414]]) {
  for (const continent of new Set(atlas.map(region => region.continent))) {
    const locations = atlas.filter(region => region.continent === continent && region.geography)
      .map(region => [region.geography!.longitude, region.geography!.latitude] as [number, number])
    const view = fitGlobeViewport(locations, width, height)!
    assert.deepEqual(view, fitGlobeViewport([...locations].reverse(), width, height), 'globe fit independent of catalog order')
    assert.deepEqual(view, fitGlobeViewport([...locations, ...locations.slice(0, 3)], width, height), 'dense cities cannot bias globe center')
    assert.ok(view.zoom >= 1 && view.zoom <= MAX_GLOBE_ZOOM)
    if (continent === 'europe') assert.ok(view.zoom > 3, 'mobile Europe must visibly enlarge')
  }
}
assert.equal(fitGlobeViewport([], 390, 388), null)
assert.equal(fitGlobeViewport([[NaN, 20]], 390, 388), null)
assert.equal(fitGlobeViewport([[10, 20]], 0, 388), null)
assert.equal(fitGlobeViewport([[10, 20]], 390, 388)!.zoom, MAX_GLOBE_ZOOM)
assert.equal(Math.abs(fitGlobeViewport([[179, 10], [-179, -10]], 390, 388)!.rotation[0]), 180, 'date-line locations retain short longitude span')
const mobileLabels = layoutMapLabels(dense, 390, 388, measure, [], new Map(), 44)
assert.ok(mobileLabels.length > 0)
for (const [i, label] of mobileLabels.entries()) {
  assert.equal(label.height, 44)
  const textTop = label.y + 12
  assert.ok(Math.hypot(Math.max(label.x, Math.min(label.x + label.width, label.nodeX)) - label.nodeX,
    Math.max(textTop, Math.min(textTop + 20, label.nodeY)) - label.nodeY) <= MAX_MAP_LABEL_LEADER, 'city names remain adjacent to their actual node')
  assert.ok(label.x >= 8 && label.x + label.width <= 382 && label.y >= 8 && label.y + label.height <= 380)
  for (const other of mobileLabels.slice(i + 1)) assert.ok(!overlap(label, other), 'mobile hit targets must not overlap')
}
console.log('Mobile globe: bounded geographic fit, date line, density/order stability and non-overlapping touch label geometry passed')
assert.ok(layoutMapLabels([point('A', 200, 160)], 390, 388, measure, [], new Map([['A', 60]])).length > 0, 'switching touch to desktop ignores a cached touch-only slot')
for(const locale of ['zh-CN','zh-TW','en']){
  assert.equal(homeMapRegionLabel({city:'Singapore',code:'ap-singapore-1'},locale,true),locale==='en'?'Singapore':'新加坡')
  assert.equal(homeMapRegionLabel({city:'Singapore',code:'ap-singapore-2'},locale,true),locale==='en'?'Singapore West':'新加坡西部')
}
const neighbors = [point('Batam',138,152),point('Kulai',137,151),point('Singapore',134,150),point('Singapore West',142,153)]
const neighborLabels = layoutMapLabels(neighbors,320,310,text=>text==='Singapore West'?63:Math.max(44,text.length*7),[],new Map(),44)
assert.equal(neighborLabels.length,4,'neighboring regions share nearby placement space rather than hiding Singapore labels')
assert.deepEqual(layoutMapLabels([...neighbors].reverse(),320,310,text=>text==='Singapore West'?63:Math.max(44,text.length*7),[],new Map(),44),neighborLabels,'cluster solution remains deterministic')
for(const [i,label]of neighborLabels.entries())for(const other of neighborLabels.slice(i+1))assert.ok(!overlap(label,other))
console.log('Nearby touch labels retain all four Singapore-area names and distinct Singapore West identity')
