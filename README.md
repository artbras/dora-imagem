# Dora-imagem

Sistema de geração/variação de imagens de cestas com IA, usando Base + Referência, revisão humana e salvamento final no Google Drive.

## Status
- **Finalizado e arquivado** ✅
- Última atualização operacional: **2026-04-13**

## Acessos (produção)
- Frontend: `https://dora.adoromimos.com.br`
- Backend/API: `https://api.dora.adoromimos.com.br`
- Healthcheck API: `https://api.dora.adoromimos.com.br/health`

## Stack (final)
- Frontend: React + Vite (Vercel)
- Backend: Fastify + TypeScript
- Worker: BullMQ + TypeScript
- Banco/Auth: Supabase
- Entrada/Saída de arquivos: Google Drive (OAuth)
- Runtime backend/worker: VPS com Docker Compose isolado (coexistindo com EasyPanel)

## Modelos IA (final)
- Provedor OpenAI (GPT imagem): seleção em `/config` (ex.: `gpt-image-1`, `gpt-image-1.5`)
- Provedor Google (Gemini imagem): seleção em `/config` (ex.: `gemini-2.5-flash-image`, `gemini-3-pro-image-preview`, `gemini-3.1-flash-image-preview`)
- O job usa o modelo do provedor selecionado em `/config`.
- Observabilidade: `processing_logs.message` registra `model` e `api_model`.

## Fluxo entregue
1. Login Google (admin autorizado)
2. Carregamento de imagens Base e Referência
3. Seleção de modelo (GPT / Nano Banana)
4. Geração por task
5. Aprovação/recusa e sequência automática
6. Salvamento no Drive em `.webp` (`<base>+<referencia>.webp`)

## Estrutura
- `codigo/frontend` app web
- `codigo/backend` API
- `codigo/worker` processamento assíncrono
- `base-de-conhecimento` documentação técnica
- `dados-historico` encerramento e registros operacionais
- `secrets` credenciais operacionais (não versionado)

## Credenciais
- Credenciais do projeto centralizadas em `secrets/credentials-production.env`.
- Diretório `secrets/` é ignorado no Git e deve permanecer privado.

## Documentação de referência
- `dados-historico/STATUS-RESOLVIDO.md`
- `dados-historico/registro-operacional-2026-04-10.md`
- `dados-historico/registro-operacional-2026-04-11.md`
- `dados-historico/registro-operacional-2026-04-13.md`
- `base-de-conhecimento/referencias/estado-atual-2026-04-07.md`
- `base-de-conhecimento/referencias/acessos-operacionais.md`
- `base-de-conhecimento/referencias/migracao-supabase-runbook.md`
- `base-de-conhecimento/referencias/migracao-supabase-checklist-execucao.md`
