#!/usr/bin/env bash
# Nightly disaster-recovery backup → off-box.
# Builds a single .tar.zst (pg_dump -Fc + uploads + sources + .env/configs + pes-data
# minus logs), checksums it, ships to the backup box, and rotates copies there.
#
# Layout on backup box:
#   /root/backups/daily/   keep last 7
#   /root/backups/weekly/  keep last 4  (written on Sundays)
#
# Topology is env-driven (matches deploy-bot convention). Override via /etc/godcrm-dr.env.
set -euo pipefail

# --- config (override in /etc/godcrm-dr.env) -------------------------------
BACKUP_HOST="${BACKUP_HOST:-<DR_IP>}"
BACKUP_USER="${BACKUP_USER:-root}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/backups}"
SRC="${SRC:-/root/production/business-crm}"
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
[ -f /etc/godcrm-dr.env ] && . /etc/godcrm-dr.env

# DB connection comes from the app .env (TCP + password; the local socket is peer-only).
if [ -f "$SRC/.env" ]; then
  PGHOST="$(grep -E '^POSTGRES_HOST='     "$SRC/.env" | head -1 | cut -d= -f2-)"
  PGPORT="$(grep -E '^POSTGRES_PORT='     "$SRC/.env" | head -1 | cut -d= -f2-)"
  PGDB="$(grep   -E '^POSTGRES_DB='       "$SRC/.env" | head -1 | cut -d= -f2-)"
  PGUSER="$(grep -E '^POSTGRES_USER='     "$SRC/.env" | head -1 | cut -d= -f2-)"
  export PGPASSWORD="$(grep -E '^POSTGRES_PASSWORD=' "$SRC/.env" | head -1 | cut -d= -f2-)"
fi
PGHOST="${PGHOST:-127.0.0.1}"; PGPORT="${PGPORT:-5432}"
PGDB="${PGDB:-godcrm_prod}";   PGUSER="${PGUSER:-godcrm}"
# localhost → force TCP so we hit scram-sha-256, not the peer socket
[ "$PGHOST" = "localhost" ] && PGHOST="127.0.0.1"

SSH="ssh -o BatchMode=yes -o ConnectTimeout=15 ${BACKUP_USER}@${BACKUP_HOST}"
TS="$(date +%Y-%m-%d_%H%M%S)"
NAME="godcrm-dr-${TS}.tar.zst"
STAGE="$(mktemp -d /tmp/dr-XXXXXX)"
trap 'rm -rf "$STAGE"' EXIT

log(){ echo "[dr-backup $(date +%H:%M:%S)] $*"; }

# --- 1. db dump ------------------------------------------------------------
log "pg_dump ${PGDB} via ${PGHOST}:${PGPORT}"
pg_dump -Fc -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$PGDB" > "$STAGE/${PGDB}_${TS}.dump"

# --- 2. manifest -----------------------------------------------------------
{
  echo "godcrm disaster-recovery snapshot"
  echo "created : $(date -Is)"
  echo "host    : $(hostname) $(hostname -I | awk '{print $1}')"
  echo "git HEAD: $(git -C "$SRC" rev-parse HEAD 2>/dev/null || echo n/a)"
  echo "db dump : ${PGDB}_${TS}.dump"
} > "$STAGE/MANIFEST.txt"

# --- 3. tar + zstd ---------------------------------------------------------
log "building ${NAME}"
tar -C / \
  --exclude='*/node_modules' --exclude='*/.git' --exclude='*/dist' \
  --exclude='*/release' --exclude='*/god_frame/build' --exclude='*/.gitnexus' \
  --exclude='*.AppImage' \
  --exclude='*/pes-core/pes-data/pes.log*' \
  -cf - \
    "${SRC#/}" \
  -C "$STAGE" "${PGDB}_${TS}.dump" MANIFEST.txt \
  | zstd -T0 -19 -q -o "$STAGE/$NAME"

SHA="$(sha256sum "$STAGE/$NAME" | awk '{print $1}')"
SIZE="$(du -h "$STAGE/$NAME" | cut -f1)"
log "built $SIZE  sha256=${SHA:0:12}…"

# --- 4. ship ---------------------------------------------------------------
SUB="daily"; [ "$(date +%u)" = "7" ] && SUB="weekly"
$SSH "mkdir -p ${BACKUP_ROOT}/daily ${BACKUP_ROOT}/weekly"
log "uploading → ${BACKUP_HOST}:${BACKUP_ROOT}/${SUB}/"
rsync -az --partial "$STAGE/$NAME" "${BACKUP_USER}@${BACKUP_HOST}:${BACKUP_ROOT}/${SUB}/"

# --- 5. verify checksum on remote -----------------------------------------
RSHA="$($SSH "sha256sum ${BACKUP_ROOT}/${SUB}/${NAME} | awk '{print \$1}'")"
if [ "$SHA" != "$RSHA" ]; then
  log "CHECKSUM MISMATCH local=$SHA remote=$RSHA"; exit 1
fi
log "CHECKSUM_OK (local == remote)"

# --- 6. rotate -------------------------------------------------------------
$SSH "ls -1t ${BACKUP_ROOT}/daily/godcrm-dr-*.tar.zst  2>/dev/null | tail -n +$((KEEP_DAILY+1))  | xargs -r rm -f"
$SSH "ls -1t ${BACKUP_ROOT}/weekly/godcrm-dr-*.tar.zst 2>/dev/null | tail -n +$((KEEP_WEEKLY+1)) | xargs -r rm -f"
log "done. kept ${KEEP_DAILY} daily / ${KEEP_WEEKLY} weekly"
