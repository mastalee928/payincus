-- Remove default image choices; instances and historical tasks store their
-- image strings independently and must keep their disk, billing and evidence.
DELETE FROM system_images
WHERE remote_alias ~ '^(images:)?(debian/(11|bullseye)|ubuntu/(25[.]10|questing))/cloud(/(amd64|arm64|x86_64|aarch64))?$';
