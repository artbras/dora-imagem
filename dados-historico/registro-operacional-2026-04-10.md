# Registro Operacional — 2026-04-10

## Entregas do dia
- Criados materiais de migração Supabase Cloud -> self-hosted:
  - `base-de-conhecimento/referencias/migracao-supabase-runbook.md`
  - `base-de-conhecimento/referencias/migracao-supabase-checklist-execucao.md`
  - `codigo/scripts/export-supabase-tables.sh`
  - `codigo/scripts/export-supabase-public.sql`
- Corrigida seleção de modelo no worker:
  - remoção de fallback silencioso para GPT quando `job.model=nano_banana`.
- Adicionado log explícito de modelo real em `processing_logs`:
  - `api_model=...`.
- Validado ambiente de runtime na VPS:
  - Dora em Docker Compose isolado (`/opt/dora-imagem/repo/docker-compose.vps.yml`), coexistindo com stack EasyPanel.
- Correção de modelo Nano Banana Pro:
  - `gemini-3-pro-image` (inválido) -> `gemini-3-pro-image-preview` (válido no provider).

## Segurança operacional
- Intervenções feitas com escopo mínimo.
- Restart realizado apenas no `dora-worker`.
- n8n permaneceu estável durante manutenção.

## Evidência
- Job `29c698f9-a5c9-4939-93e5-13ef38af686b` concluído com:
  - `model=nano_banana`
  - `api_model=gemini-3-pro-image-preview`
