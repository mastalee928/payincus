export const status = (enabled = true) => ({ enabled, username: 'fixture-display-only', port: 8444, hasPassword: true, natPublicIp: '192.0.2.11', sitesCount: enabled ? 8 : 0 })
export const sites = (page = 1, total = 8) => ({ page, pageSize: 5, total, totalPages: Math.ceil(total / 5),
  sites: Array.from({ length: Math.max(0, Math.min(5, total - (page - 1) * 5)) }, (_, index) => {
    const id = (page - 1) * 5 + index + 1
    return { id, domain: `site-${id}.example.test`, targetPort: 8080, httpsEnabled: true, status: id % 2 ? 'active' : 'pending', enabled: true, error: null,
      createdAt: '2026-10-30T00:00:00.000Z', instance: { id, name: `Debian app ${id}`, ipv4: '10.0.0.2', status: 'running' } }
  }) })
