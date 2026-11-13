/** Resource values in platform records use MiB (1024 MiB per GiB). */
export function incusResourceSize(mib: number): string {
  if (!Number.isSafeInteger(mib) || mib <= 0) throw Error('RESOURCE_SIZE_INVALID')
  return `${mib}MiB`
}
