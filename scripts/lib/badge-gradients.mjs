// The original HTML definitions are absent. Reconstruct only missing element
// backgrounds from the corresponding shipped stroke palette; retain existing defs.
const elementPalettes = {
  'a-air': { d: ['#0c4a6e', '#082f49'], l: ['#f0f9ff', '#bae6fd'] },
  'a-fire': { d: ['#7f1d1d', '#450a0a'], l: ['#fef2f2', '#fecaca'] },
  'a-water': { d: ['#4c1d95', '#2e1065'], l: ['#f5f3ff', '#ddd6fe'] },
  'a-earth': { d: ['#14532d', '#052e16'], l: ['#f0fdf4', '#bbf7d0'] },
  'z-earth': { d: ['#581c87', '#3b0764'], l: ['#faf5ff', '#e9d5ff'] },
  'z-fire': { d: ['#881337', '#4c0519'], l: ['#fff1f2', '#fecdd3'] },
  'z-metal': { d: ['#78350f', '#451a03'], l: ['#fffbeb', '#fde68a'] },
  'z-water': { d: ['#164e63', '#083344'], l: ['#ecfeff', '#a5f3fc'] },
  'z-wood': { d: ['#064e3b', '#022c22'], l: ['#ecfdf5', '#a7f3d0'] },
}

export function completeBadgeGradients(svg) {
  const ids = new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]))
  const references = [...new Set([...svg.matchAll(/url\(#([^)]+)\)/g)].map(match => match[1]))]
  const additions = []
  for (const id of references.filter(id => !ids.has(id))) {
    const match = /^bg-([az]-[a-z]+)-([dl])$/.exec(id)
    const colors = match && elementPalettes[match[1]]?.[match[2]]
    if (!colors) throw new Error(`Missing badge SVG definition: ${id}`)
    additions.push(`<linearGradient id="${id}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${colors[0]}"></stop><stop offset="100%" stop-color="${colors[1]}"></stop></linearGradient>`)
  }
  if (!additions.length) return svg
  const defs = additions.join('')
  return svg.includes('</defs>') ? svg.replace('</defs>', `${defs}</defs>`)
    : svg.replace(/^(<svg\b[^>]*>)/, `$1<defs>${defs}</defs>`)
}
