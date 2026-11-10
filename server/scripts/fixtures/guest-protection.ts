import { randomUUID } from 'node:crypto'
import { GUEST_NETWORK_CAPABILITY } from '../../src/lib/guest-network-protection.js'

// Inventory/accounting fixtures model a current Agent receipt. Native Agent
// tests independently verify the actual host firewall and its failure handling.
export function protectedAgentFixture(capabilities: string[] = []) {
  return {
    agentId: randomUUID(), secretHash: 'unused-fixture', secretEncrypted: 'unused-fixture',
    enabled: true, lastSeenAt: new Date(), capabilities: [...capabilities, GUEST_NETWORK_CAPABILITY],
    lastReport: { guestProtectionStatus: { applied: true, checkedAt: new Date().toISOString() } }
  }
}
