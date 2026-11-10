# Alpine OpenSSH regression baselines

These are the original Alpine-signed **vulnerable** OpenSSH APKs used only in
disposable CI containers to verify the updater. They are never copied into the
panel release or installed on a host or customer instance.

Alpine 3.19, 3.23 and then 3.24 CDN requests repeatedly returned 404 on GitHub runners.
All seven tested branch/architecture combinations now use fixed official baselines.
The exact official objects were downloaded on 2026-11-11; `manifest.json` records
their official URLs, revisions, sizes and SHA-256 digests. The native test checks
these bytes and then `apk add` verifies their signatures using the container's
original Alpine trust keys. Neither an unsigned package nor a newer baseline may
replace these files. No branch depends on continued CDN retention of retired revisions.

OpenSSH is distributed under the BSD and related permissive licenses recorded in
the upstream source: <https://github.com/openssh/openssh-portable/blob/master/LICENCE>.
The APK package metadata identifies its upstream and declared license.
