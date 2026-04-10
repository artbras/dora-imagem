# Dora-imagem — Estado Atual (2026-04-07)

## Stack e Deploy
- Frontend: Vercel (`https://dora.adoromimos.com.br`)
- Backend + Worker + Redis: VPS separada (coexistente com EasyPanel), em **Docker Compose isolado** (`/opt/dora-imagem/repo/docker-compose.vps.yml`)
- Banco/Auth: Supabase
- Armazenamento de entrada/saída: Google Drive (OAuth)

## Fluxo funcional implementado
1. Login Google restrito ao admin (`am.agente.ia@gmail.com`).
2. Conexão Drive automática no login (quando necessário).
3. Carregamento das imagens de Base e Referência.
4. Seleção de LLM na operação:
   - GPT (OpenAI)
   - Nano Banana (Gemini Nano Banana Pro)
5. Geração por task, revisão visual e ações:
   - Salvar
   - Recusar
   - Gerar Sequência Selecionada
   - Cancelar
6. Salvamento no Drive de saída (`Resultados`) em `.webp` com nome:
   - `<nome-base>+<nome-referencia>.webp`

## LLMs
- GPT: integração real via OpenAI Images edit (modelo fixado em `gpt-image-1.5`).
- Nano Banana: integração real via Gemini API oficial (`gemini-3-pro-image-preview`, display name: Nano Banana Pro).
- Em falha de geração, comportamento é falhar e avisar (sem fallback automático).

## Nota operacional (2026-04-10)
- O nome `gemini-3-pro-image` **não é válido** no provider atual; tentativa com esse identificador causou retry/falha em jobs Nano Banana.
- Validação oficial via `ListModels` confirmou modelo correto para Nano Banana Pro: `models/gemini-3-pro-image-preview`.
- Worker atualizado para logar `api_model` em `processing_logs.message`, permitindo auditoria direta do modelo real usado por task.

## UX/UI implementada
- Tema dark premium.
- Background custom aplicado em login/operação/config.
- Logos custom no login e seleção de LLM.
- Miniaturas em 4 colunas para Base/Referência.
- Referência com seleção única.
- Modal de zoom da imagem gerada com controle `+/-`.
- Barra de progresso e modal bloqueante para sequência automática.
- Botão `LIMPAR` ao final da sequência.

## Ajustes críticos realizados
- Correções de OAuth redirect e sessão (refresh automático em 401).
- Correção de MIME no envio para OpenAI (evitando `application/octet-stream`).
- Correção de duplicidade na sequência automática:
  - approve idempotente
  - claim atômico por status `generated`
- Redução de carga:
  - polling de job em 5s
  - endpoint `/jobs/:id` com payload enxuto

## Evidência operacional mais recente
- Job de validação com 3 imagens processou e salvou 3/3 sem duplicidade.
- IDs de saída confirmados em `image_tasks.output_image_id`.
