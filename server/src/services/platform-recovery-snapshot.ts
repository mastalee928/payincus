import { backupRoot, ensure, readJson, validateId, writeJson } from './platform-backup-core.js'
import { join } from 'node:path'
import { pgRecoveryTransaction, pgQuery } from './platform-backup-database.js'
import { recoveryDatasetHash, type RecoveryQuery } from './platform-recovery-state.js'

const categories = ['finance','access','tasks'] as const
interface SnapshotReceipt {
  version: 1; batchId: string; databaseOid: number; snapshotAt: string
  hashes: Record<(typeof categories)[number], string>
}
const receiptPath=(id:string)=>join(backupRoot(),'results',`snapshot-${validateId(id)}.json`)

// Root writes this only after authenticated archive restore, integrity checking,
// migration and isolation. It attests the selected snapshot, never later trades.
export async function saveRestoredSnapshot(batchId:string,snapshotAt:string,database:string) {
  ensure(Number.isFinite(Date.parse(snapshotAt)),'OSS_DATABASE_INTEGRITY_INVALID',409)
  const receipt=await pgRecoveryTransaction(async query=>{
    const [row]=await query<{oid:number}>('SELECT oid::int FROM pg_database WHERE datname=current_database()')
    const hashes={} as SnapshotReceipt['hashes']
    for(const category of categories)hashes[category]=await recoveryDatasetHash(category,query)
    return {version:1 as const,batchId,databaseOid:row.oid,snapshotAt,hashes}
  },database)
  await writeJson(receiptPath(batchId),receipt,0o640)
}

export async function restoredSnapshot(batchId:string,snapshotAt:string,query:RecoveryQuery=pgQuery) {
  const receipt=await readJson<SnapshotReceipt>(receiptPath(batchId))
  ensure(receipt?.version===1 && receipt.batchId===batchId && receipt.snapshotAt===snapshotAt &&
    Number.isSafeInteger(receipt.databaseOid) && receipt.databaseOid>0 &&
    categories.every(category=>/^[a-f0-9]{64}$/.test(receipt.hashes?.[category]||'')),
    'OSS_RECOVERY_SNAPSHOT_RECEIPT_MISSING',409)
  const [row]=await query<{oid:number}>('SELECT oid::int FROM pg_database WHERE datname=current_database()')
  ensure(row?.oid===receipt.databaseOid,'OSS_RECOVERY_DATABASE_IDENTITY_MISSING',409)
  return receipt
}
