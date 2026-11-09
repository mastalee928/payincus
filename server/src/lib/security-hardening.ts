export const SECURITY_HARDENING_REVISION = 'customer-hardening-v3'
export const SECURITY_HARDENING_ENABLED_KEY = 'automatic_security_hardening'
export type HardeningPhase = 'authority' | 'inventory' | 'runtime' | 'host-inspection' | 'customer-ssh' | 'receipt' | 'finished'
export type HardeningDiagnostic = {
  phase: HardeningPhase; reason: string; instanceId?: number; action: 'wait' | 'inspect' | 'blocked'; nextAction: string
}
export type HardeningCheck = { status: 'verified' | 'not-applicable' | 'retry' | 'needs-maintenance'; reason?: string }
export type HardeningState = {
  revision: string; status: 'verified' | 'retry' | 'needs-maintenance'; attempts: number; checkedAt: string; nextCheckAt: string
  updateAttempts?: number
  identityHash?: string
  remoteRequestId?: string
  maintenance?: unknown
  phase?: HardeningPhase; diagnostic?: HardeningDiagnostic
  leaseToken?: string; host?: { apparmor: HardeningCheck; ssh: HardeningCheck; preflight?: HardeningCheck }
  environment?: import('../services/host-security-inspection.js').HostHardeningPreflight
  instances?: Array<{ instanceId: number; isolation: HardeningCheck; ssh: HardeningCheck }>
  error?: string
}
export function hardeningFailure(error: unknown): HardeningCheck {
  const raw = error instanceof Error ? error.message : ''
  const code = (error as { code?: unknown } | null)?.code
  const message = typeof code === 'string' && /^[A-Z_]{1,100}$/.test(code) ? code : raw
  if (['CUSTOMER_PRIVILEGE_FORBIDDEN', 'CUSTOMER_ISOLATION_UNSAFE'].includes(String(code)) ||
    ['CUSTOMER_PRIVILEGE_FORBIDDEN', 'CUSTOMER_ISOLATION_UNSAFE'].includes(message)) {
    return { status: 'needs-maintenance', reason: String(code || message) }
  }
  const reasons = ['HARDENING_IDENTITY_MISSING', 'HARDENING_IDENTITY_CHANGED', 'HARDENING_ADMIN_REQUIRED',
    'HARDENING_DISABLED', 'HARDENING_GUEST_RUNTIME_UNSAFE', 'HARDENING_GUEST_NOT_RUNNING', 'HARDENING_APPARMOR_REQUIRED',
    'HARDENING_PROBE_UNSUPPORTED', 'HARDENING_RETRY_EXHAUSTED', 'ALPINE_SSH_INSTANCE_IDENTITY_CHANGED', 'ALPINE_SSH_PASSWORD_UNAVAILABLE',
    'ALPINE_SSH_ADMIN_REQUIRED', 'SSH_HOST_KEY_CHANGED', 'ALPINE_SSH_UNSUPPORTED', 'HARDENING_GATEWAY_PROTOCOL_REQUIRED',
    'HARDENING_ARCH_UNSUPPORTED', 'HARDENING_VM_RUNTIME_UNVERIFIED', 'HARDENING_FILESYSTEM_READONLY',
    'HARDENING_APPARMOR_KERNEL_UNSUPPORTED', 'HARDENING_APPARMOR_BOOT_DISABLED', 'HARDENING_JOURNAL_CONFLICT',
    'HARDENING_RECIPE_UNSUPPORTED','HARDENING_BOOT_LAYOUT_UNSUPPORTED','HARDENING_CONTROL_PLANE_TARGET',
    'HARDENING_APPARMOR_TOOLS_REQUIRED','HARDENING_CUSTOMER_BOOT_RECOVERY_UNVERIFIED','HARDENING_RECONNECT_TIMEOUT',
    'HARDENING_PREPARATION_RETRY_EXHAUSTED']
  if (reasons.includes(message)) return { status: 'needs-maintenance', reason: message }
  return { status: 'retry', reason: ['HARDENING_BUSY', 'HARDENING_OFFLINE', 'HARDENING_RECOVERY_HELD',
    'ALPINE_SSH_INSTANCE_BUSY', 'ALPINE_SSH_TARGET_NOT_READY', 'ALPINE_SSH_RECOVERY_HELD',
    'ALPINE_SSH_UPDATE_FAILED', 'ALPINE_SSH_VERIFICATION_FAILED', 'HOST_SECURITY_MAINTENANCE', 'HARDENING_MEMORY_LOW', 'HARDENING_MEMORY_PRESSURE',
    'HARDENING_DISK_LOW', 'HARDENING_PACKAGE_BUSY', 'SSH_CONNECT_FAILED', 'SSH_DISCONNECTED', 'SSH_COMMAND_TIMEOUT',
    'SSH_AUTH_FAILED', 'SSH_COMMAND_FAILED', 'ALPINE_SSH_PATCH_REQUIRED', 'HARDENING_REMOTE_BUSY', 'HARDENING_ONBOARDING_PENDING',
    'HARDENING_PREPARE_FAILED','HARDENING_PREPARE_INCOMPLETE','HARDENING_RECONNECT_INCOMPLETE','HARDENING_REMOTE_RESULT_UNKNOWN','HARDENING_BATCH_PAUSED','HARDENING_REQUEST_EXPIRED'].includes(message) ? message : 'HARDENING_CHECK_FAILED' }
}
/** Only actual update/verification failures consume the write budget. A busy,
 * offline or unknown probe must not reset an exhausted budget or use it up. */
export function hardeningUpdateBudget(previous: Partial<HardeningState>): number {
  const count = previous.updateAttempts
  if (previous.error === 'HARDENING_RETRY_EXHAUSTED') return Math.max(6, Number.isSafeInteger(count) && count! >= 0 ? Math.min(count!, 1000000) : 6)
  return Number.isSafeInteger(count) && count! >= 0 ? Math.min(count!, 1000000) : 0
}
export function hardeningNeedsReadOnlyRecovery(previous: Partial<HardeningState>): boolean {
  return Boolean(previous.leaseToken) || ['SSH_COMMAND_TIMEOUT', 'SSH_DISCONNECTED', 'SSH_COMMAND_FAILED', 'HARDENING_CHECK_FAILED',
    'ALPINE_SSH_UPDATE_FAILED', 'ALPINE_SSH_VERIFICATION_FAILED', 'HARDENING_REMOTE_BUSY'].some(reason => reason === previous.error ||
      (Array.isArray(previous.instances) && previous.instances.some(row => row && typeof row === 'object' && row.ssh?.reason === reason)))
}
export function hardeningPhaseLabel(phase: HardeningPhase): string {
  return { authority: '授权与原身份', inventory: '客户清单与任务冲突', runtime: '客户实际隔离',
    'host-inspection': '宿主检查与补丁', 'customer-ssh': '客户 SSH 检查与补丁', receipt: '最终身份与归属复核', finished: '验证完成' }[phase]
}
export function hardeningDiagnostic(reason: string, phase: HardeningPhase, instanceId?: number): HardeningDiagnostic {
  const check = hardeningFailure(new Error(reason))
  const waiting = ['HARDENING_BUSY', 'HARDENING_OFFLINE', 'HARDENING_RECOVERY_HELD', 'ALPINE_SSH_INSTANCE_BUSY',
    'ALPINE_SSH_TARGET_NOT_READY', 'ALPINE_SSH_RECOVERY_HELD', 'HARDENING_MEMORY_LOW', 'HARDENING_MEMORY_PRESSURE',
    'HARDENING_DISK_LOW', 'HARDENING_PACKAGE_BUSY', 'SSH_CONNECT_FAILED', 'SSH_DISCONNECTED'].includes(check.reason || '')
  const action = check.status === 'needs-maintenance' ? 'blocked' : waiting ? 'wait' : 'inspect'
  return { phase, reason: check.reason!, ...(instanceId ? { instanceId } : {}), action,
    nextAction: action === 'blocked' ? '保留原身份与客户状态；只读复核阻断条件，未通过前不继续更新' :
      action === 'wait' ? '按退避时间复核当前条件，恢复后沿原身份自动继续' :
        '先只读核原身份、实际补丁及监听状态，确认后再决定是否续接；不凭超时重做更新' }
}
export function hardeningSchedule(checks: HardeningCheck[], attempts: number, now = Date.now()) {
  const status = checks.some(check => check.status === 'retry') ? 'retry' as const :
    checks.some(check => check.status === 'needs-maintenance') ? 'needs-maintenance' as const : 'verified' as const
  const delay = status === 'retry' ? Math.min(30 * 60_000, 30_000 * 2 ** Math.min(Math.max(attempts - 1, 0), 6)) :
    status === 'needs-maintenance' ? 6 * 60 * 60_000 : 24 * 60 * 60_000
  return { status, nextCheckAt: new Date(now + delay).toISOString() }
}
export function hardeningReason(reason?: string): string {
  const reasons: Record<string, string> = {
    HARDENING_APPARMOR_REQUIRED: '宿主未启用 AppArmor，需验证内核支持并安排维护',
    HARDENING_ONBOARDING_PENDING: '接入安全检查尚未全部通过，系统将自动复核；宿主暂不可售',
    HARDENING_APPARMOR_KERNEL_UNSUPPORTED: '未取得当前内核 AppArmor 支持证据，重启不能代替内核支持检查',
    HARDENING_REMOTE_BUSY: '原远端更新任务仍在运行，保持同请求等待并只读核验',
    HARDENING_JOURNAL_CONFLICT: '远端维修回执或原配置已变化，停止更新并保留原身份',
    HARDENING_APPARMOR_BOOT_DISABLED: '当前启动参数禁用了 AppArmor，需验证引导配置与回退后再准备维护',
    HARDENING_PROBE_UNSUPPORTED: '宿主缺少经过验证的检查工具或系统，不自动安装或升级',
    HARDENING_GATEWAY_PROTOCOL_REQUIRED: '原网关组件尚不支持当前检查协议，等待经原受信升级流程更新组件',
    HARDENING_RETRY_EXHAUSTED: '自动重试连续六次仍未通过，已停止更新；检查原通道和失败步骤后安排维护',
    HARDENING_PREPARATION_RETRY_EXHAUSTED: '防护准备已安全回退两次仍未通过，已停止重新准备；保留原回执和具体失败步骤继续复核',
    HARDENING_GUEST_RUNTIME_UNSAFE: '客户实际 UID/GID 映射或 Seccomp 未通过检查',
    HARDENING_GUEST_NOT_RUNNING: '客户未运行，保留原状态；运行后再核实际隔离和 SSH',
    CUSTOMER_PRIVILEGE_FORBIDDEN: '客户配置启用了特权，转换需要安排维护',
    CUSTOMER_ISOLATION_UNSAFE: '客户有效配置含不符合隔离政策的设置，保留原运行实例',
    HARDENING_IDENTITY_MISSING: '缺少原宿主受信身份或管理路径',
    HARDENING_IDENTITY_CHANGED: '宿主身份或绑定发生变化，原任务结果未采纳',
    HARDENING_ADMIN_REQUIRED: '原接入管理员当前授权无效', HARDENING_DISABLED: '自动加固已关闭',
    ALPINE_SSH_INSTANCE_IDENTITY_CHANGED: '客户与原登记身份不一致，未重新信任',
    ALPINE_SSH_PASSWORD_UNAVAILABLE: '原客户密码不可用，未重置密码',
    ALPINE_SSH_ADMIN_REQUIRED: '当前管理员授权无效', SSH_HOST_KEY_CHANGED: '管理 SSH 身份与原记录不符',
    ALPINE_SSH_UNSUPPORTED: '当前 Alpine 分支或 OpenSSH 配置不在已验证补丁范围',
    HARDENING_BUSY: '有关任务仍在执行，稍后自动继续', HARDENING_OFFLINE: '宿主管理通道暂未就绪',
    ALPINE_SSH_INSTANCE_BUSY: '客户有未完成操作，稍后自动继续',
    ALPINE_SSH_TARGET_NOT_READY: '客户原密码连接或管理状态尚未就绪',
    ALPINE_SSH_UPDATE_FAILED: '官方 SSH 补丁或服务重载未完成，将重新核验后续接',
    ALPINE_SSH_PATCH_REQUIRED: '只读复核确认客户补丁或监听仍未就绪，将沿原身份重新检查后续接',
    HARDENING_RECOVERY_HELD: '平台恢复保护正在生效，解除后自动继续',
    ALPINE_SSH_RECOVERY_HELD: '平台恢复保护正在生效，解除后自动继续',
    ALPINE_SSH_VERIFICATION_FAILED: '原连接或新密码登录尚未通过验证',
    HARDENING_CHECK_FAILED: '未取得有效检查回执，稍后重新检查',
    HARDENING_ARCH_UNSUPPORTED: '目标宿主架构不在 AMD64/ARM64 支持范围，未下发更新',
    HARDENING_VM_RUNTIME_UNVERIFIED: '客户为虚拟机，实际 QEMU 防护检查尚未支持，未记为已加固',
    HARDENING_FILESYSTEM_READONLY: '宿主根文件系统为只读，未执行补丁更新',
    HARDENING_MEMORY_LOW: '宿主可用内存不足，推迟更新并保留自动续接',
    HARDENING_MEMORY_PRESSURE: '宿主正在承受内存回收压力，推迟更新并保留自动续接',
    HARDENING_DISK_LOW: '宿主根分区空间或 inode 不足，未清理客户数据，稍后复核',
    HARDENING_PACKAGE_BUSY: '宿主包管理器仍在执行或持锁，等待结束后重新检查',
    HARDENING_RECIPE_UNSUPPORTED: '当前系统与架构尚无通过启动验收的自动维护方案',
    HARDENING_BOOT_LAYOUT_UNSUPPORTED: '实际引导配置不符合已验证方案，保留原配置并记录差异',
    HARDENING_CONTROL_PLANE_TARGET: '目标承载主控或网关，须先验证独立受信恢复通道',
    HARDENING_APPARMOR_TOOLS_REQUIRED: '防护依赖尚未准备完成，将核对原维护记录和官方包后续接',
    HARDENING_CUSTOMER_BOOT_RECOVERY_UNVERIFIED: '原客户身份、持久属性或恢复条件未通过，保留原实例并复核',
    HARDENING_RECONNECT_TIMEOUT: '未在维护期限内确认重连，保留回执继续核原启动身份，不重复重启',
    HARDENING_PREPARE_FAILED: '防护准备未完成，按原任务核对实际结果后继续',
    HARDENING_PREPARE_INCOMPLETE: '防护准备中断，将按原配置与回执续接',
    HARDENING_RECONNECT_INCOMPLETE: '重启后的管理通道、防护或客户恢复尚未全部通过，继续沿原身份验收',
    HARDENING_REMOTE_RESULT_UNKNOWN: '远端回执未明确，继续查询原请求结果',
    HARDENING_BATCH_PAUSED: '前一台维护尚未验收，自动等待后再处理下一台',
    HARDENING_REQUEST_EXPIRED: '本次受限请求已过期，复核原任务后自动续接',
    SSH_CONNECT_FAILED: '原受信 SSH 管理通道暂无法连接，稍后重连检查',
    SSH_DISCONNECTED: '原管理连接中断，先检查实际执行结果后续接',
    SSH_COMMAND_TIMEOUT: '管理操作等待超时，先检查远端实际结果，不视为进程已停止',
    SSH_AUTH_FAILED: '原管理密钥认证未通过，保留原身份并重新检查',
    SSH_COMMAND_FAILED: '受限管理命令未取得有效结果，将先只读复核'
  }
  return reasons[reason || ''] || (reason ? '未取得受支持的诊断结果，等待只读复核' : '检查通过')
}
