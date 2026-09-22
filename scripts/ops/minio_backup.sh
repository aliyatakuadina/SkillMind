#!/usr/bin/env bash
# Backup skillmind-media from MinIO to a path outside the primary disk.
# Requires mc configured with alias "skillmind" (or set MC_ALIAS).
set -euo pipefail

ALIAS="${MC_ALIAS:-skillmind}"
BUCKET="${MINIO_BUCKET:-skillmind-media}"
DEST_ROOT="${BACKUP_ROOT:?Set BACKUP_ROOT to an external volume, e.g. /mnt/backup/skillmind}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${DEST_ROOT}/${BUCKET}-${STAMP}"

mkdir -p "$DEST"
echo "Mirroring ${ALIAS}/${BUCKET} -> ${DEST}"
mc mirror --preserve "${ALIAS}/${BUCKET}" "$DEST"
echo "$DEST" > "${DEST_ROOT}/latest-skillmind-media.txt"
echo "Backup complete: $DEST"

# Restore smoke (dry listing):
# mc ls "${ALIAS}/${BUCKET}" | head
# Restore example (destructive — run only after deliberate review):
# mc mirror --overwrite "$DEST" "${ALIAS}/${BUCKET}"
