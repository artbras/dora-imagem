#!/usr/bin/env bash
set -euo pipefail

# Migração completa Supabase (origem -> destino) com foco em segurança operacional.
# Requisitos:
# - pg_dump, psql, pg_restore
# - acesso network às duas instâncias
#
# Uso:
#   chmod +x codigo/scripts/migrate-supabase-instance.sh
#   SOURCE_DB_URL='postgresql://...' TARGET_DB_URL='postgresql://...' ./codigo/scripts/migrate-supabase-instance.sh
#
# Variáveis opcionais:
#   MIGRATION_DIR=./tmp/migration
#   WITH_ROLES=false         # default false (recomendado para Supabase)
#   WITH_STORAGE=false       # default false (storage é bucket/object, fora do Postgres principal)

SOURCE_DB_URL="${SOURCE_DB_URL:-}"
TARGET_DB_URL="${TARGET_DB_URL:-}"
MIGRATION_DIR="${MIGRATION_DIR:-./tmp/migration}"
WITH_ROLES="${WITH_ROLES:-false}"

if [[ -z "$SOURCE_DB_URL" || -z "$TARGET_DB_URL" ]]; then
  echo "[ERRO] Defina SOURCE_DB_URL e TARGET_DB_URL"
  exit 1
fi

mkdir -p "$MIGRATION_DIR"
SCHEMA_DUMP="$MIGRATION_DIR/schema.dump"
DATA_DUMP="$MIGRATION_DIR/data.dump"
PRECHECK_SQL="$MIGRATION_DIR/precheck.sql"
POSTCHECK_SQL="$MIGRATION_DIR/postcheck.sql"

cat > "$PRECHECK_SQL" <<'SQL'
select 'extensions', count(*) from pg_extension;
select 'public_tables', count(*) from information_schema.tables where table_schema='public';
select 'public_functions', count(*) from information_schema.routines where specific_schema='public';
SQL

cat > "$POSTCHECK_SQL" <<'SQL'
select 'public_tables', count(*) from information_schema.tables where table_schema='public';
select 'public_functions', count(*) from information_schema.routines where specific_schema='public';
select 'public_jobs', count(*) from public.jobs;
select 'public_image_tasks', count(*) from public.image_tasks;
select 'public_app_config', count(*) from public.app_config;
SQL

echo "[1/8] Precheck origem"
psql "$SOURCE_DB_URL" -v ON_ERROR_STOP=1 -f "$PRECHECK_SQL"

echo "[2/8] Dump schema (sem owners/acls)"
pg_dump "$SOURCE_DB_URL" \
  --schema-only \
  --no-owner --no-privileges \
  --format=custom \
  --file="$SCHEMA_DUMP"

echo "[3/8] Dump dados (public)"
pg_dump "$SOURCE_DB_URL" \
  --data-only \
  --schema=public \
  --no-owner --no-privileges \
  --format=custom \
  --file="$DATA_DUMP"

echo "[4/8] Precheck destino"
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f "$PRECHECK_SQL"

echo "[5/8] Restore schema no destino"
pg_restore --no-owner --no-privileges --clean --if-exists --exit-on-error \
  --dbname="$TARGET_DB_URL" "$SCHEMA_DUMP"

echo "[6/8] Restore dados no destino"
pg_restore --no-owner --no-privileges --disable-triggers --exit-on-error \
  --dbname="$TARGET_DB_URL" "$DATA_DUMP"

echo "[7/8] Ajustes pós-restore (sequences)"
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT
      quote_ident(n.nspname) AS schemaname,
      quote_ident(c.relname) AS tablename,
      quote_ident(a.attname) AS colname,
      pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) AS seqname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE c.relkind = 'r'
      AND n.nspname = 'public'
      AND a.attnum > 0
      AND NOT a.attisdropped
  LOOP
    IF r.seqname IS NOT NULL THEN
      EXECUTE format('SELECT setval(%L, COALESCE((SELECT MAX(%s) FROM %s.%s), 1), true);',
        r.seqname, r.colname, r.schemaname, r.tablename);
    END IF;
  END LOOP;
END $$;
SQL

echo "[8/8] Pós-check destino"
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f "$POSTCHECK_SQL"

echo "[OK] Migração concluída. Valide autenticação, storage buckets, edge functions e secrets no painel Supabase destino."
