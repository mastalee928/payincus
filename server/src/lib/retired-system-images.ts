/** Versions removed from the platform's default catalog by the owner. */
export function retiredDefaultSystemImage(alias: string): boolean {
  return /^(?:images:)?(?:debian\/(?:11|bullseye)|ubuntu\/(?:25\.10|questing))\/cloud(?:\/(?:amd64|arm64|x86_64|aarch64))?$/.test(alias)
}
