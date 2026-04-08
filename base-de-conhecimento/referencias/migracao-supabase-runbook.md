# Runbook — Migração Supabase (instância origem -> instância destino)

## Objetivo
Migrar estrutura e dados principais do Dora-imagem para outra instância Supabase de forma reprodutível e segura.

## Script oficial
- `codigo/scripts/migrate-supabase-instance.sh`

## Pré-requisitos
- `pg_dump`, `pg_restore`, `psql`
- Conectividade às duas instâncias
- URL de conexão Postgres (origem e destino)

## Variáveis
- `SOURCE_DB_URL` (obrigatória)
- `TARGET_DB_URL` (obrigatória)
- `MIGRATION_DIR` (opcional; default `./tmp/migration`)

## Execução
```bash
cd codigo
SOURCE_DB_URL='postgresql://<origem>' \
TARGET_DB_URL='postgresql://<destino>' \
./scripts/migrate-supabase-instance.sh
```

## O que o script faz
1. Precheck na origem.
2. Dump de schema (sem owner/acls).
3. Dump de dados (schema `public`).
4. Precheck no destino.
5. Restore de schema com `--clean --if-exists`.
6. Restore de dados.
7. Ajuste de sequences.
8. Pós-check com contagens críticas.

## Itens fora do escopo do dump Postgres
Após a migração, ajustar manualmente no Supabase destino:
- Auth providers/configurações OAuth
- Buckets/objetos de Storage
- Edge Functions e variáveis secret
- RLS/policies custom fora do schema migrado (se houver diferenças de ambiente)

## Validação final (Dora-imagem)
- Login admin funcionando
- Leitura das pastas Base/Referência do Drive
- Geração de imagem (GPT e Nano Banana)
- Salvamento em `Resultados` com padrão `<base>+<referencia>.webp`
- Sequência automática sem duplicidade
