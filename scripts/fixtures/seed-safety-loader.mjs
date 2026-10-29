// This process fixture replaces every database module before a seed can connect.
export async function resolve(specifier, context, nextResolve) {
  if (/\/src\/db\/(?:index|prisma)\.js$/.test(specifier)) {
    return { url: new URL('./seed-safety-db.mjs', import.meta.url).href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
