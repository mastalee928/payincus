import * as db from '../src/db/index.js'
import { closePrismaDatabase, prisma } from '../src/db/prisma.js'
import { getIncusClient, getInstance, getInstanceState } from '../src/lib/incus/index.js'
import { closeAllClients } from '../src/lib/incus/incus-pool.js'
import { parseBackfillInstanceNetworkArgs } from './lib/backfill-instance-network-args.js'
import {
  persistResolvedInstanceNetworkAddresses,
  instanceNetworkHostIdentity,
  resolveInstanceNetworkAddresses,
  type IncusNetworkStateLike
} from '../src/lib/instance-network-sync.js'

async function main(): Promise<void> {
  const { dryRun, hostId } = parseBackfillInstanceNetworkArgs(process.argv.slice(2))

  const allHosts = await db.getAllHosts()
  const hosts = allHosts.filter(host => host.status !== 'offline' && (hostId === null || host.id === hostId))

  if (hosts.length === 0) {
    console.log('[BackfillInstanceNetwork] No matching online hosts found')
    return
  }

  let scanned = 0
  let changedInstances = 0
  let ipv4ChangedCount = 0
  let ipv6ChangedCount = 0
  let failed = 0
  let plannedInstances = 0
  let plannedIpv4 = 0
  let plannedIpv6 = 0

  console.log(`[BackfillInstanceNetwork] Starting${dryRun ? ' dry-run' : ''} for ${hosts.length} host(s)`)

  for (const host of hosts) {
    console.log(`[BackfillInstanceNetwork] Host #${host.id} ${host.name}`)

    let client: Awaited<ReturnType<typeof getIncusClient>>
    let hostConnectionIdentity: string
    let hostOwnerId: number
    try {
      const currentHost = await prisma.host.findUniqueOrThrow({ where: { id: host.id } })
      hostConnectionIdentity = instanceNetworkHostIdentity(currentHost)
      hostOwnerId = currentHost.userId
      client = await getIncusClient(host)
    } catch (error) {
      failed++
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[BackfillInstanceNetwork] Failed to connect host #${host.id}: ${message}`)
      continue
    }

    const instances = await prisma.instance.findMany({
      where: {
        hostId: host.id,
        status: { notIn: ['deleted', 'creating'] }
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        incusId: true,
        hostId: true,
        userId: true,
        updatedAt: true,
        networkMode: true,
        ipv4: true,
        ipv6: true
      }
    })

    for (const instance of instances) {
      scanned++

      try {
        const incusInstance = await getInstance(client, instance.incusId)

        let state: IncusNetworkStateLike | null = null
        try {
          state = await getInstanceState(client, instance.incusId) as IncusNetworkStateLike
        } catch {
          state = null
        }

        const resolved = resolveInstanceNetworkAddresses(
          {
            id: instance.id,
            name: instance.name,
            networkMode: instance.networkMode,
            ipv4: instance.ipv4,
            ipv6: instance.ipv6
          },
          incusInstance,
          state
        )

        const ipv4WillChange = (instance.ipv4 ?? null) !== (resolved.ipv4 ?? null)
        const ipv6WillChange = (instance.ipv6 ?? null) !== (resolved.ipv6 ?? null)

        if (!ipv4WillChange && !ipv6WillChange) {
          continue
        }

        if (dryRun) {
          plannedInstances++
          if (ipv4WillChange) plannedIpv4++
          if (ipv6WillChange) plannedIpv6++
          console.log(
            `[BackfillInstanceNetwork] DRY-RUN instance #${instance.id} ${instance.name}: `
            + `ipv4 ${instance.ipv4 ?? '-'} -> ${resolved.ipv4 ?? '-'}, `
            + `ipv6 ${instance.ipv6 ?? '-'} -> ${resolved.ipv6 ?? '-'}`
          )
          continue
        }

        const persisted = await persistResolvedInstanceNetworkAddresses(
          {
            id: instance.id,
            name: instance.name,
            hostId: instance.hostId,
            userId: instance.userId,
            incusId: instance.incusId,
            updatedAt: instance.updatedAt.toISOString(),
            hostOwnerId,
            hostConnectionIdentity,
            networkMode: instance.networkMode,
            ipv4: instance.ipv4,
            ipv6: instance.ipv6
          },
          resolved,
          { updateLastSyncedAt: true }
        )

        changedInstances++
        if (persisted.ipv4Changed) ipv4ChangedCount++
        if (persisted.ipv6Changed) ipv6ChangedCount++
        console.log(
          `[BackfillInstanceNetwork] Updated instance #${instance.id} ${instance.name}: `
          + `ipv4 ${persisted.oldIpv4 ?? '-'} -> ${persisted.newIpv4 ?? '-'}, `
          + `ipv6 ${persisted.oldIpv6 ?? '-'} -> ${persisted.newIpv6 ?? '-'}`
        )
      } catch (error) {
        failed++
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[BackfillInstanceNetwork] Failed instance #${instance.id} ${instance.name}: ${message}`)
      }
    }
  }

  console.log(
    `[BackfillInstanceNetwork] Completed${dryRun ? ' dry-run' : ''}: `
    + `scanned=${scanned}, changed=${changedInstances}, `
    + `ipv4Changed=${ipv4ChangedCount}, ipv6Changed=${ipv6ChangedCount}, failed=${failed}`
    + (dryRun ? `, planned=${plannedInstances}, ipv4Planned=${plannedIpv4}, ipv6Planned=${plannedIpv6}` : '')
  )
  if (failed > 0) process.exitCode = 1
}

main()
  .catch(error => {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    console.error(`[BackfillInstanceNetwork] Fatal error: ${message}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeAllClients()
    await closePrismaDatabase()
    // Let closed socket/adapter handles finish their callbacks before exiting.
    setTimeout(() => process.exit(process.exitCode || 0), 100)
  })
