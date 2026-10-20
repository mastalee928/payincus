export interface OssConfig {
  revision: string; installationId: string; enabled: boolean; region: string; bucket: string; prefix: string
  accessKeyId: string; hasAccessKeySecret: boolean; hasBackupPassword: boolean; intervalHours: number; retention: number
  nextRunAt: string | null; testedRevision: string | null
}
export interface OssTask {
  id: string; kind: 'backup' | 'preview' | 'restore' | 'resume' | 'rollback'; status: 'pending' | 'running' | 'success' | 'failed' | 'warning'
  createdAt: string; updatedAt: string; stage: string; error?: string; bytes?: number; objectPrefix?: string
  preview?: { version: string; createdAt: string; files: number; expiresAt: string }
}
export interface OssBackup { id: string; installationId: string; prefix: string; createdAt: string; version: string; bytes: number; sha256: string }
export interface OssDirectory {
  directories: string[]; objects: Array<{ name: string; size: number; lastModified: string }>; nextCursor: string | null
}
