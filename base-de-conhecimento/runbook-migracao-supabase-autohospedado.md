# Runbook — Migração Supabase Cloud -> Supabase Autohospedado (Dora-imagem)

Atualizado em: 2026-05-01

## Objetivo
Migrar o Dora-imagem do Supabase atual para Supabase autohospedado com risco controlado e rollback simples.

## Escopo
- Banco Postgres (schema + data)
- Auth (configuração/redirects/providers)
- Storage (buckets/objetos)
- Secrets do frontend/backend/worker

## Pré-requisitos
- Supabase autohospedado já provisionado e saudável
- Acesso de rede origem/destino
- Ferramentas: `psql`, `pg_dump`, `pg_restore`
- Janela curta de freeze de escrita

## Variáveis
```bash
export SOURCE_DB_URL='postgresql://...origem...'
export TARGET_DB_URL='postgresql://...destino...'
export MIGRATION_DIR='./tmp/migration-$(date +%Y%m%d-%H%M%S)'
```

## Etapa 1 — Precheck
```bash
psql "$SOURCE_DB_URL" -c 'select now(), version();'
psql "$TARGET_DB_URL" -c 'select now(), version();'
```

## Etapa 2 — Freeze curto de escrita
- Pausar criação de novos jobs no Dora durante dump/restore.

## Etapa 3 — Migração de banco (public)
```bash
cd codigo
SOURCE_DB_URL="$SOURCE_DB_URL" TARGET_DB_URL="$TARGET_DB_URL" MIGRATION_DIR="$MIGRATION_DIR" ./scripts/migrate-supabase-instance.sh
```

## Etapa 4 — Migração de Storage
- Exportar objetos dos buckets da origem.
- Importar no storage do autohospedado mantendo paths/chaves.
- Validar buckets usados pelo Dora.

## Etapa 5 — Auth no destino
- Configurar provider Google OAuth.
- Ajustar URLs de redirect/callback.
- Validar emissor JWT e validade de tokens.

## Etapa 6 — Atualizar secrets da aplicação
Atualizar para o novo Supabase:
- Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- Backend/worker: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

## Etapa 7 — Deploy
- Deploy/restart de backend
- Deploy/restart de worker
- Deploy frontend

## Etapa 8 — Validação funcional (go/no-go)
1. Login e sessão
2. `/config` ler/salvar
3. Criar job
4. Poll de job sem 401 indevido
5. Approve/reject task
6. `processing_logs` preenchendo
7. Salvamento final no Drive

## Rollback
Se falhar em produção:
1. Voltar env vars para Supabase antigo
2. Redeploy backend/worker/frontend
3. Reabrir escrita

## Observações
- O script atual cobre bem `public`, mas Auth/Storage requerem etapa própria.
- Para cargas grandes, preferir janela controlada e validação por amostragem + contagens.
