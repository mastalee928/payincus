import type { FastifyInstance } from 'fastify'
import { maintainAlpineCustomerSsh } from '../services/alpine-ssh-maintenance.js'

const reasons: Record<string, string> = {
  ALPINE_SSH_ADMIN_REQUIRED: '管理员会话已失效，请重新登录',
  ALPINE_SSH_RECOVERY_HELD: '平台正在恢复，SSH 安全维护暂未执行',
  ALPINE_SSH_INSTANCE_BUSY: '实例仍有未完成操作，SSH 安全维护暂未执行',
  ALPINE_SSH_TARGET_NOT_READY: '实例或原管理连接尚未就绪，SSH 安全维护暂未执行',
  ALPINE_SSH_INSTANCE_IDENTITY_CHANGED: '实例身份与原登记不一致，SSH 安全维护已停止',
  ALPINE_SSH_UPDATE_FAILED: '官方补丁安装或服务重载未完成，未重置密码，请查看管理员日志',
  ALPINE_SSH_VERIFICATION_FAILED: 'SSH 安全维护未完成验证，未重置密码，请查看管理员日志'
}

export default async function alpineSshSecurityRoutes(fastify: FastifyInstance,
  options: { maintain?: typeof maintainAlpineCustomerSsh } = {}) {
  const maintain = options.maintain || maintainAlpineCustomerSsh
  fastify.post<{ Params: { id: string } }>('/:id/ssh-security', {
    onRequest: [fastify.authenticateAdmin],
    config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', additionalProperties: false, properties: {} } }
  }, async (request, reply) => {
    const id = Number(request.params.id)
    if (!/^[1-9]\d*$/.test(request.params.id) || !Number.isSafeInteger(id) || id > 2147483647) {
      return reply.code(400).send({ error: 'INVALID_ID', message: '实例编号无效' })
    }
    try { return await maintain(id, request.user.id, undefined, request.user) }
    catch (error) {
      const code = error instanceof Error && /^ALPINE_SSH_[A-Z_]+$/.test(error.message)
        ? error.message : 'ALPINE_SSH_VERIFICATION_FAILED'
      return reply.code(code === 'ALPINE_SSH_ADMIN_REQUIRED' ? 403 : 409).send({ error: code,
        message: reasons[code] || 'SSH 安全检查未完成，保留原密码，请查看管理员日志' })
    }
  })
}
