#!/usr/bin/env bash
# Recrée la base de test et applique le stub Supabase puis toutes les migrations.
set -euo pipefail
DB="${PGDATABASE:-gbs_test}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$DIR/tests/supabase_stub.sql"
for f in "$DIR"/migrations/*.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" --single-transaction -f "$f"
done
echo "Base $DB prête."
