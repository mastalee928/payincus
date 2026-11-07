export type HardeningCheckView = { status: string; reason: string | null }
export type HardeningView = {
  revision: string | null; status: string; fresh: boolean; phase: string | null; checkedAt: string | null; nextCheckAt: string | null
  attempts: number; updateAttempts: number
  host: { preflight: HardeningCheckView; apparmor: HardeningCheckView; ssh: HardeningCheckView } | null
  instances: Array<{ instanceId: number; isolation: HardeningCheckView; ssh: HardeningCheckView }>
  environment: { architecture: string | null; pageSize: number | null; memoryAvailableKiB: number | null; memoryPressure: number | null;
    rootAvailableBytes: number | null; rootAvailableInodes: number | null; rootReadonly: boolean | null; packageBusy: boolean | null;
    apparmorKernelSupport: boolean | null; apparmorBootDisabled: boolean | null; apparmorActive: boolean | null; bootloader: string } | null
  diagnostic: { phase: string; reason: string; action: string; instanceId: number | null } | null
  maintenance?: {phase:string;startedAt:string|null;deadline:string|null;rebootIssued:boolean;reason:string|null;history?:Array<{phase:string;at:string;reason:string|null}>}|null
}
