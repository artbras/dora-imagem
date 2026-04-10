#!/usr/bin/env bash
set -euo pipefail

# Exporta tabelas + conteúdos do Supabase (Postgres) para arquivos de dump.
# Uso rápido:
#   chmod +x codigo/scripts/export-supabase-tables.sh
#   SOURCE_DB_URL='postgresql://...' ./codigo/scripts/export-supabase-tables.sh
#
# Variáveis suportadas:
#   SOURCE_DB_URL   (obrigatória)
#   EXPORT_DIR      (opcional, default: ./tmp/export-YYYYmmdd-HHMMSS)
#   SCHEMAS         (opcional, default: public)
#                    Ex: SCHEMAS='public,auth,storage'
#   TABLES          (opcional, lista separada por vírgula)
#                    Ex: TABLES='public.jobs,public.image_tasks'
#   INCLUDE_BLOBS   (opcional, default: false)
#                    true => inclui large objects no dump full

SOURCE_DB_URL="${SOURCE_DB_URL:-}"
EXPORT_DIR="${EXPORT_DIR:-./tmp/export-$(date +%Y%m%d-%H%M%S)}"
SCHEMAS="${SCHEMAS:-public}"
TABLES="${TABLES:-}"
INCLUDE_BLOBS="${INCLUDE_BLOBS:-false}"

if [[ -z "$SOURCE_DB_URL" ]]; then
  echo "[ERRO] Defina SOURCE_DB_URL"
  exit 1
fi

mkdir -p "$EXPORT_DIR"

FULL_DUMP="$EXPORT_DIR/full.dump"
SCHEMA_SQL="$EXPORT_DIR/schema.sql"
DATA_DUMP="$EXPORT_DIR/data.dump"
MANIFEST="$EXPORT_DIR/manifest.txt"

# Monta flags de schema
SCHEMA_FLAGS=()
IFS=',' read -r -a schema_arr <<< "$SCHEMAS"
for s in "${schema_arr[@]}"; do
  s_trim="$(echo "$s" | xargs)"
  [[ -n "$s_trim" ]] && SCHEMA_FLAGS+=("--schema=$s_trim")
done

# Monta flags de tabela (opcional)
TABLE_FLAGS=()
if [[ -n "$TABLES" ]]; then
  IFS=',' read -r -a table_arr <<< "$TABLES"
  for t in "${table_arr[@]}"; do
    t_trim="$(echo "$t" | xargs)"
    [[ -n "$t_trim" ]] && TABLE_FLAGS+=("--table=$t_trim")
  done
fi

echo "[1/5] Precheck conexão"
psql "$SOURCE_DB_URL" -v ON_ERROR_STOP=1 -c 'select now() as source_now;'

echo "[2/5] Export schema legível (schema.sql)"
pg_dump "$SOURCE_DB_URL" \
  --schema-only \
  --no-owner --no-privileges \
  "${SCHEMA_FLAGS[@]}" \
  "${TABLE_FLAGS[@]}" \
  --file="$SCHEMA_SQL"

echo "[3/5] Export dados (data.dump custom)"
pg_dump "$SOURCE_DB_URL" \
  --data-only \
  --format=custom \
  --no-owner --no-privileges \
  "${SCHEMA_FLAGS[@]}" \
  "${TABLE_FLAGS[@]}" \
  --file="$DATA_DUMP"

echo "[4/5] Export full (schema+data) para restauração direta"
BLOB_FLAG="--no-blobs"
if [[ "$INCLUDE_BLOBS" == "true" ]]; then
  BLOB_FLAG="--blobs"
fi

pg_dump "$SOURCE_DB_URL" \
  --format=custom \
  --no-owner --no-privileges \
  "$BLOB_FLAG" \
  "${SCHEMA_FLAGS[@]}" \
  "${TABLE_FLAGS[@]}" \
  --file="$FULL_DUMP"

echo "[5/5] Gerando manifesto"
{
  echo "exported_at=$(date -Iseconds)"
  echo "schemas=$SCHEMAS"
  echo "tables=${TABLES:-<all tables in selected schemas>}"
  echo "include_blobs=$INCLUDE_BLOBS"
  echo "source_db_url_redacted=${SOURCE_DB_URL%%@*}@***"
  echo "files:"
  ls -lh "$SCHEMA_SQL" "$DATA_DUMP" "$FULL_DUMP"
} > "$MANIFEST"

echo "[OK] Export concluído em: $EXPORT_DIR"
echo "Arquivos gerados:"
echo " - $SCHEMA_SQL"
echo " - $DATA_DUMP"
echo " - $FULL_DUMP"
echo " - $MANIFEST"

echo
echo "Exemplo de restore no destino (schema SQL + data custom):"
echo "  psql 'postgresql://<destino>' -f '$SCHEMA_SQL'"
echo "  pg_restore --no-owner --no-privileges --disable-triggers --dbname='postgresql://<destino>' '$DATA_DUMP'"
