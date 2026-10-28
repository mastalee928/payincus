# Instances and Resource Delivery

The primary delivery object in PayIncus is an Incus-backed LXC / KVM instance. The user portal handles customer self-service, while the admin console handles global operations and troubleshooting.

## Delivery Flow

1. The user selects a plan, image and host.
2. The backend validates balance, plan limits, host capacity and quotas.
3. The system creates order and billing records.
4. The backend calls Incus or the host Agent to create the instance.
5. Success syncs state, network information, limits and billing status.
6. Failure triggers compensation so the user is not charged for an undelivered resource.

## User Features

| Feature | Description |
| --- | --- |
| Create instance | Create LXC / KVM instances from plans, images and hosts. |
| Instance list | View status, resources, expiry and actions. |
| Instance detail | View CPU, memory, disk, network, IPv6, mappings and runtime status. |
| Lifecycle actions | Start, stop, reboot and delete. |
| Web terminal | Connect through `/api/ws`. |
| Snapshots | Instance details expose snapshots subject to quota; automatic snapshots follow enabled policies. |
| Traffic | View usage, reset state and limit notifications. |

## Admin Features

Backend instance backup, export, upload, and restore paths remain available, but the current instance detail page has no dedicated backup tab. An existing API is not evidence of a complete self-service page. The current automatic policy scheduler runs snapshots, not instance backup policies. Admin [OSS platform backup](/deployment/oss-backup) is a separate workflow for the database, configuration, and managed identities; it does not include customer VPS disks. Full disaster recovery requires separate validation.

- View and manage all customer instances.
- Create instances manually for delivery correction or migration.
- Manage hosts, images, initialization commands and storage settings.
- Troubleshoot failed delivery through logs, Agent reports and task state.

## Backend Modules

- `instances`, `instance-billing`, `instance-destroy`.
- `terminal`, `snapshots`, `backups`, `traffic`.
- `agent` for host heartbeat, resource reporting and instance state reporting.

## Risks

- Failed creation must compensate billing state.
- Failed, timed out or stale delivery tasks must notify the user and leave an auditable admin log.
- Non-idempotent delivery tasks must not be retried automatically.
- Deletion must clean Incus resources and local records.
- Terminal WebSocket must verify identity and instance ownership.
- Admin operations must be audited.
- Stale Agent state can affect capacity decisions.
