// Read host public keys through the authenticated guest-management channel.
// New OpenSSH releases can add algorithms beyond RSA/ECDSA/Ed25519. Keep the
// complete key set so ssh-keyscan cannot report a legitimate but unpinned key.
export const guestSshFingerprintsCommand = 'for key in /etc/ssh/ssh_host_*_key.pub; do [ ! -f "$key" ] || ssh-keygen -lf "$key" -E sha256 || exit 1; done'
