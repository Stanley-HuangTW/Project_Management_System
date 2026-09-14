#!/usr/bin/env bash
# Backs up everything the app keeps: the Postgres database AND the uploaded
# attachments. Both are needed — a database dump on its own restores every
# attachment's row with its file missing.
#
# Writes timestamped files and deletes backups older than $RETENTION_DAYS.
# Meant to run from the repo root (same directory as docker-compose.yml and
# .env.production) — see docs/deploy-linux.md for the weekly cron setup.
#
# Usage: ./scripts/backup-db.sh [backup-dir]
#   backup-dir defaults to ./backups

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

BACKUP_DIR="${1:-$REPO_ROOT/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-60}"
# Pinned rather than derived from the directory name: docker compose builds
# the default project name from the folder, and a folder named in Chinese
# sanitises down to nothing ("project name must not be empty"). Every other
# command in this project passes -p hrapp for the same reason.
PROJECT="${COMPOSE_PROJECT_NAME:-hrapp}"

if [ ! -f .env.production ]; then
  echo "backup-db.sh: .env.production not found in $REPO_ROOT — aborting." >&2
  exit 1
fi

# Read just the two values we need, without exporting the whole file (it
# also holds SMTP/OAuth secrets this script has no reason to touch).
POSTGRES_USER="$(grep -m1 '^POSTGRES_USER=' .env.production | cut -d= -f2-)"
POSTGRES_DB="$(grep -m1 '^POSTGRES_DB=' .env.production | cut -d= -f2-)"
POSTGRES_USER="${POSTGRES_USER:-hrapp}"
POSTGRES_DB="${POSTGRES_DB:-hrapp_db}"

mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date +%Y-%m-%d_%H%M%S)"
DB_FILE="$BACKUP_DIR/${POSTGRES_DB}_${TIMESTAMP}.sql.gz"
UPLOADS_FILE="$BACKUP_DIR/uploads_${TIMESTAMP}.tgz"

# Everything is written to a .part file and only renamed once the command has
# actually succeeded. The shell creates the redirect target before the command
# runs, so without this a failure leaves a zero-byte file sitting there looking
# exactly like a backup.
finish() {
  local part="$1" final="$2"
  if [ -s "$part" ]; then
    mv "$part" "$final"
    echo "Done: $final ($(du -h "$final" | cut -f1))"
  else
    rm -f "$part"
    echo "backup-db.sh: produced nothing for $final — aborting." >&2
    exit 1
  fi
}

echo "Backing up $POSTGRES_DB ..."
docker compose -p "$PROJECT" --env-file .env.production exec -T db \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip > "$DB_FILE.part"
finish "$DB_FILE.part" "$DB_FILE"

# The attachments live in a named volume, not on the host, so they are read
# out through a throwaway container. An empty uploads directory is normal on a
# fresh install and still produces a valid (tiny) tarball.
echo "Backing up uploaded attachments ..."
# MSYS_NO_PATHCONV stops Git Bash on Windows from rewriting the in-container
# paths into Windows ones before docker ever sees them; on Linux it is just an
# unused variable, so one script covers both.
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "${PROJECT}_uploads_data:/v:ro" \
  -v "$BACKUP_DIR:/out" \
  alpine tar czf "/out/$(basename "$UPLOADS_FILE").part" -C /v .
finish "$UPLOADS_FILE.part" "$UPLOADS_FILE"

echo "Removing backups older than $RETENTION_DAYS days ..."
find "$BACKUP_DIR" -name "${POSTGRES_DB}_*.sql.gz" -mtime "+$RETENTION_DAYS" -print -delete
find "$BACKUP_DIR" -name "uploads_*.tgz" -mtime "+$RETENTION_DAYS" -print -delete

echo "Current backups:"
ls -lh "$BACKUP_DIR"
