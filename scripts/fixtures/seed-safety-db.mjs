console.error('SEED_DB_MODULE_LOADED')
export function initPrismaDatabase() { throw new Error('SEED_DATABASE_BOUNDARY_REACHED') }
export const prisma = new Proxy({}, { get() { throw new Error('SEED_DATABASE_BOUNDARY_REACHED') } })
export async function closePrismaDatabase() {}
