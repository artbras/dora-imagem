# Dora-imagem

Sistema de alteração de tecido em cestas com IA.

## Stack inicial
- Frontend: React + Vite
- Backend: Fastify + TypeScript
- Worker: BullMQ + TypeScript
- Banco: Supabase (Postgres)
- Deploy: Vercel (pendente credenciais)

## Estrutura
- `codigo/frontend` app web
- `codigo/backend` API
- `codigo/worker` processamento assíncrono
- `base-de-conhecimento` PRD e decisões
- `dados-historico` registro operacional

## Execução rápida
```bash
npm install
npm run dev:frontend
npm run dev:backend
npm run dev:worker
```
