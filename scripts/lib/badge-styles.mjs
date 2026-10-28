// Source documents contain JSX <style> elements inside Babel scripts. Each badge
// renders its own component styles; only real document styles are shared.
export function documentBadgeStyles(html) {
  const documentMarkup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
  return [...documentMarkup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)]
    .map(match => match[1].trim()).filter(Boolean).join('\n')
}
