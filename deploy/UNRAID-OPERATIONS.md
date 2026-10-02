# Unraid operations

Run from the homelab repository. The wrapper defaults to /mnt/user/appdata/lu4-stats-v2/homelab.env; set LU4_ENV_FILE for a custom absolute path. No credentials are printed or sourced as shell code.

```bash
bash deploy/ops/unraid-stack.sh status
bash deploy/ops/unraid-stack.sh health
bash deploy/ops/unraid-stack.sh backup
```

The health command exits nonzero when any of four servers lacks an observation within 45 minutes or the database cannot be queried. This threshold tolerates ordinary collection time; imported history alone does not establish live collection health. These checks do not yet send notifications or check disk/backup age.

In Unraid User Scripts, schedule a daily job containing:

```bash
#!/bin/bash
bash /mnt/user/appdata/lu4-stats-v2/repository/deploy/ops/unraid-stack.sh backup
```

Choose a low-activity time such as 03:00 in the server's configured timezone. The job uses a nonblocking host lock, propagates failure, and preserves existing backups. Verify the first scheduled execution's logs. No retention pruning is enabled; monitor free space until an off-host destination and retention policy are configured. User Scripts installation/scheduling remains a host action, not performed by preparing these files.

With the lu4 Compose shortcut from HOMELAB.md, test a chosen backup:

```bash
lu4 run --rm restore-drill lu4-YYYYMMDDTHHMMSSZ-PID.dump
```

Use the actual basename in the backup directory. The drill verifies the checksum and restores into a newly created lu4_restore_* database; cleanup drops only that isolated database. It prints restored schema version and per-server counts. It does not overwrite production. Allow disk space for another database and run during low activity. It does not prove off-host disaster recovery or validate every application query.

Passwords are stored in the private homelab.env and matching database-password secret. Keep an encrypted recovery copy outside this machine, preferably in a password manager alongside the setup paths and SSH recovery details. Do not commit them, paste them into logs, or share them. Database dumps do not include role passwords; provision-roles with the protected configuration recreates application role credentials. Editing the owner secret alone does not rotate PostgreSQL's existing owner password.

Back up archives separately from PostgreSQL dumps. Off-host copying, retention, notifications, and reboot validation require host/destination configuration and are pending. Never test an outage by deleting volumes. A reboot test should confirm Docker autostart, database readiness, collector freshness, and laptop tunnel reconnection.
