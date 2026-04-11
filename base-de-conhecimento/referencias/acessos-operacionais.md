# Dora-imagem — Acessos Operacionais

## Frontend (produção)
- URL principal: `https://dora.adoromimos.com.br`
- Deploy: Vercel (projeto `dora-imagem-frontend`)

## Backend/API (produção)
- URL base: `https://api.dora.adoromimos.com.br`
- Healthcheck: `GET /health`

## Runtime backend/worker
- Hospedagem: VPS dedicada do projeto Dora
- Orquestração: Docker Compose isolado
- Compose remoto: `/opt/dora-imagem/repo/docker-compose.vps.yml`
- Serviços principais:
  - `dora-api`
  - `dora-worker`
  - `dora-redis`

## Coexistência com EasyPanel
- O host possui EasyPanel e stack do n8n em paralelo.
- Regra operacional: intervenções de Dora devem ser de escopo mínimo (evitar restart global do host/stack).

## Credenciais
- Todas as credenciais operacionais do projeto ficam em:
  - `secrets/credentials-production.env`
- Observação: diretório `secrets/` é ignorado no Git e não deve ser versionado.
