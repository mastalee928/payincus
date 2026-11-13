/** Two immutable owner-selected Debian 11 container archives. No caller URL. */
export const OWNER_DEBIAN11_IMAGES = {
  x86_64: { architecture: 'x86_64', archiveArchitecture: 'amd64', size: 128196729,
    sha256: '7343b1d120bfadde3888c221d959501b9991ffaea81e60f977555c94775ab463' },
  aarch64: { architecture: 'aarch64', archiveArchitecture: 'arm64', size: 126189063,
    sha256: '54fb35a5532b1c17c3102237b31fa4086166f09339aa723f44d8ed0846864831' }
} as const

export function ownerSelectedContainerImage(alias: string, architecture: string) {
  const match = /^images:debian\/11\/cloud(?:\/(amd64|arm64|x86_64|aarch64))?$/.exec(alias)
  if (!match) return null
  const arch = ['x86_64', 'amd64'].includes(architecture) ? 'x86_64' : ['aarch64', 'arm64'].includes(architecture) ? 'aarch64' : null
  if (!arch || match[1] && (['arm64', 'aarch64'].includes(match[1]) ? 'aarch64' : 'x86_64') !== arch) return null
  return OWNER_DEBIAN11_IMAGES[arch]
}
