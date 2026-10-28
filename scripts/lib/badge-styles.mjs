// Source documents contain JSX <style> elements inside Babel scripts. Each badge
// renders its own component styles; only real document styles are shared.
export function documentBadgeStyles(html) {
  const documentMarkup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
  return [...documentMarkup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)]
    .map(match => match[1].trim()).filter(Boolean).join('\n')
}

export function normalizeBadgeMotion(svg) {
  let result = svg.replace(/(<style>)([\s\S]*?)(<\/style>)/g, (_, open, css, close) =>
    open + css.replace(/(animation:(?:zt1a|zg1a|zro1a)\b[^;}]*?\balternate)\s+(transform-origin:)/g, '$1;$2') + close)
  const additions = []
  if (/animation:\s*art\b/.test(result) && !/@keyframes\s+art\b/.test(result)) {
    additions.push('@keyframes art{to{transform:rotate(360deg)}}')
  }
  if (!result.includes('prefers-reduced-motion')) {
    additions.push('@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}')
  }
  if (additions.length) result = result.replace('</svg>', `<style>${additions.join('')}</style></svg>`)
  return result
}
