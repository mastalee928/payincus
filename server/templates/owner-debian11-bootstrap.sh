#!/bin/sh
# Runs only on a fresh derivative of the owner's pinned Debian 11 image.
set -eu
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export DEBIAN_FRONTEND=noninteractive
mkdir -p /var/lib/incudal /etc/cloud/cloud.cfg.d
trap 'code=$?; if [ "$code" != 0 ]; then printf "%s\n" "$code" > /var/lib/incudal/image-bootstrap-failed; fi' EXIT
test -s /var/lib/cloud/seed/nocloud-net/user-data
test -s /var/lib/cloud/seed/nocloud-net/meta-data
# The package's own services see this marker until its installation finishes.
touch /etc/cloud/cloud-init.disabled
attempt=0
until timeout 35 apt-get -o APT::Update::Error-Mode=any -o Acquire::Retries=2 update && timeout 80 apt-get -o Acquire::Retries=2 install -y --no-install-recommends cloud-init; do
  attempt=$((attempt+1))
  test "$attempt" -lt 3
  sleep 3
done
printf 'datasource_list: [ NoCloud ]\n' > /etc/cloud/cloud.cfg.d/99-payincus-datasource.cfg
rm -f /etc/cloud/cloud-init.disabled
# Use the same generated configuration and cloud-init modules as cloud images.
# No manual completion or password-only fallback is permitted.
cloud-init init --local
cloud-init init
cloud-init modules --mode=config
cloud-init modules --mode=final
test -f /var/lib/incudal/initialization-ready
test -f /var/lib/cloud/instance/boot-finished
rm -f /var/lib/incudal/image-bootstrap-failed
touch /var/lib/incudal/image-bootstrap-complete
