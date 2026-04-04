# Plano de Execução — Dora-imagem (Microfases)

Base: `PRD-tecnico-v1.md`

## Objetivo do MVP
Entregar fluxo funcional fim a fim para:
1. autenticar usuário com Google Drive,
2. selecionar imagens base + referência,
3. processar sequencialmente 1 por vez via IA,
4. aprovar/rejeitar com retry,
5. salvar aprovadas no Drive.

---

## Fase 0 — Setup técnico (fundação)
**Entregas**
- Monorepo com 3 apps:
  - `codigo/frontend` (React)
  - `codigo/backend` (API)
  - `codigo/worker` (queue processor)
- Banco + migrations iniciais
- Variáveis de ambiente por serviço (`.env.example`)
- Logging estruturado básico

**Critério de aceite**
- Serviços sobem localmente com `docker compose up` (db + redis + apps)
- Healthcheck OK para backend e worker

---

## Fase 1 — Auth Google + Drive base
**Entregas**
- `GET /auth/google`
- `GET /auth/callback`
- persistência segura de `access_token` e `refresh_token`
- refresh automático de token expirado
- endpoint `GET /drive/files?folderId=`

**Critério de aceite**
- usuário conecta conta Google
- lista arquivos de pasta no Drive com token do usuário

---

## Fase 2 — Modelagem de Job/Task + APIs de operação
**Entregas**
- tabelas: `users`, `jobs`, `image_tasks`, `app_config`
- endpoints:
  - `POST /jobs`
  - `GET /jobs/:id`
  - `POST /jobs/:id/start`
  - `POST /tasks/:id/approve`
  - `POST /tasks/:id/reject`

**Critério de aceite**
- criar job com N imagens e 1 referência
- status/progresso retornando corretamente

---

## Fase 3 — Worker sequencial + adapter IA (MVP)
**Entregas**
- fila BullMQ (Redis)
- loop sequencial por `currentIndex`
- `ImageProcessor` interface
- `GPTAdapter` ativo
- `NanoBananaAdapter` com stub funcional (feature-flag)
- armazenamento temporário da imagem gerada

**Critério de aceite**
- 1 job com 3 imagens processa uma por vez
- cada task vai para estado `generated` aguardando decisão humana

---

## Fase 4 — Frontend operacional (job + aprovação)
**Entregas**
- Tela principal:
  - seleção imagens base (multi)
  - referência (single)
  - modelo (dropdown)
  - iniciar processamento
- Tela de aprovação:
  - preview original x gerada
  - aprovar / recusar
  - progresso (atual/total + %)

**Critério de aceite**
- operador conclui ciclo completo sem usar API manual

---

## Fase 5 — Robustez mínima de produção
**Entregas**
- retries controlados (falha IA 1x auto + rejeição manual ilimitada)
- logs essenciais por task/job
- tratamento de edge cases do PRD
- travas de concorrência para não processar mesma task 2x

**Critério de aceite**
- fluxo estável em cenários de erro comuns

---

## Ordem de implementação recomendada
1. Fase 0
2. Fase 1
3. Fase 2
4. Fase 3
5. Fase 4
6. Fase 5

---

## Decisões técnicas propostas (MVP)
- Backend: **Node.js + Fastify + TypeScript**
- Worker: **BullMQ + Redis**
- DB: **PostgreSQL**
- Frontend: **React + Vite + TypeScript**
- Storage temporário: tabela/objeto interno (sem S3 nesta fase)

---

## Decisões confirmadas
1. Output aprovado vai para uma pasta única no Drive: **"Resultados"**.
2. Reject manual sem motivo obrigatório.
3. `nano_banana` ficará atrás de **feature-flag** no MVP.
