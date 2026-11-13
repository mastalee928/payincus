/** Retry a failed signed install after discarding corrupt/stale repository
 * metadata. Sleep-only retries keep reusing a broken repomd.xml indefinitely.
 * Repository URLs, enabled repositories and RPM signature policy stay intact. */
export function rhelPackageInstallCommand(manager: 'dnf' | 'yum', packages: string[]): string {
  if (!packages.length || packages.some(name => !/^[a-zA-Z0-9][a-zA-Z0-9+_.-]*$/.test(name))) throw Error('Invalid RHEL package name')
  const install = `${manager} install -y --setopt=timeout=15 --setopt=retries=2 ${packages.join(' ')}`
  const refresh = manager === 'dnf' ? '--refresh' : '--setopt=metadata_expire=0'
  return `${install} || { ${manager} clean all && ${manager} ${refresh} -y --setopt=timeout=15 --setopt=retries=2 install ${packages.join(' ')}; }`
}
