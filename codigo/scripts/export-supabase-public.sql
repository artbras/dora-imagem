-- export-supabase-public.sql
-- Uso (no psql):
--   psql "$SOURCE_DB_URL" -v export_dir="./tmp/supabase-export" -f export-supabase-public.sql
--
-- O script exporta:
-- 1) Dados de TODAS as tabelas do schema public para CSV
-- 2) Sequências (setval) em um arquivo SQL
-- 3) Manifesto com contagem de linhas por tabela
--
-- Observação:
-- - Para schema completo (DDL), continue usando pg_dump schema-only.
-- - Este script é focado em exportação de DADOS via SQL/psql.

\set ON_ERROR_STOP on
\timing on

-- Diretório de exportação (padrão se não vier por -v export_dir=...)
\if :{?export_dir}
\else
\set export_dir './tmp/supabase-export'
\endif

\echo [1/5] Criando diretório de export...
\! mkdir -p :export_dir
\! mkdir -p :export_dir/data

\echo [2/5] Exportando dados de todas as tabelas public para CSV...
SELECT format(
  E'\\copy %I.%I TO ''%s/data/%I.%I.csv'' CSV HEADER',
  schemaname,
  tablename,
  :'export_dir',
  schemaname,
  tablename
)
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
\gexec

\echo [3/5] Exportando estado das sequences (setval) para SQL...
\o :export_dir/sequences.sql
SELECT '-- sequence state export generated at ' || now() || E'\n';
SELECT format(
  E'SELECT setval(%L, COALESCE((SELECT max(%I) FROM %I.%I), 1), true);',
  pg_get_serial_sequence(format('%I.%I', t.schemaname, t.tablename), c.column_name),
  c.column_name,
  t.schemaname,
  t.tablename
)
FROM pg_tables t
JOIN information_schema.columns c
  ON c.table_schema = t.schemaname
 AND c.table_name = t.tablename
WHERE t.schemaname = 'public'
  AND pg_get_serial_sequence(format('%I.%I', t.schemaname, t.tablename), c.column_name) IS NOT NULL
ORDER BY t.tablename, c.column_name;
\o

\echo [4/5] Gerando manifesto com row counts...
\o :export_dir/manifest.csv
\pset format csv
\pset tuples_only off
SELECT table_schema, table_name, row_count
FROM (
  SELECT
    t.schemaname AS table_schema,
    t.tablename  AS table_name,
    (xpath('/row/cnt/text()', query_to_xml(format('SELECT count(*) AS cnt FROM %I.%I', t.schemaname, t.tablename), true, true, '')))[1]::text::bigint AS row_count
  FROM pg_tables t
  WHERE t.schemaname = 'public'
) s
ORDER BY table_name;
\o
\pset format aligned

\echo [5/5] Gerando README de importação...
\o :export_dir/README_IMPORT.txt
\qecho Passos sugeridos para importar no destino:
\qecho 1) Recrie o schema/DDL no destino (preferencialmente com pg_dump --schema-only da origem).
\qecho 2) Importe os CSVs para cada tabela com \copy.
\qecho 3) Execute sequences.sql para ajustar setval.
\qecho 4) Compare manifest.csv (origem) com contagens no destino.
\o

\echo [OK] Export concluído em :export_dir
\echo Arquivos:
\echo - :export_dir/data/*.csv
\echo - :export_dir/sequences.sql
\echo - :export_dir/manifest.csv
\echo - :export_dir/README_IMPORT.txt
