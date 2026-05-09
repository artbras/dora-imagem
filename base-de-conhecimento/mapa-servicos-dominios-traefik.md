# Mapa de Serviços, Domínios e Traefik — Dora-imagem

Atualizado em: 2026-05-01

## 1) Domínio base do EasyPanel

- **Base:** `xhtfrz.easypanel.host`
- Exemplos de subdomínios detectados no host:
  - `adoromimo-evolution-api.xhtfrz.easypanel.host`
  - `adoromimo-n8n.xhtfrz.easypanel.host`

## 2) Domínios custom ativos (stack Dora)

- `dora.adoromimos.com.br` (frontend)
- `api.dora.adoromimos.com.br` (backend API)
- `n8n.adoromimos.com.br` (n8n no mesmo host/ecossistema)

## 3) Fontes de evidência no servidor

- Certificados/ACME:
  - `/etc/easypanel/traefik/acme.json`
- Configuração Traefik:
  - `/etc/easypanel/traefik/config/main.yaml`
  - `/etc/easypanel/traefik/config/dora-api.yml`
  - `/etc/easypanel/traefik/config/dora-imgops.yml`
- Stack Dora:
  - `/opt/dora-imagem/dora-stack.yml`

## 4) Relação serviço -> domínio (operacional)

- **dora-api** -> `api.dora.adoromimos.com.br`
- **frontend Dora** -> `dora.adoromimos.com.br`
- **n8n** -> `n8n.adoromimos.com.br`

## 5) Observações operacionais

- O domínio custom pode servir bundle antigo por cache/roteamento edge mesmo com deploy novo READY no Vercel.
- Sempre validar versão efetiva em produção pela URL do asset (`/assets/index-*.js`) após deploy.
- Quando houver divergência entre commit e bundle servido, revisar:
  1. projeto/domínio correto no Vercel,
  2. promote de deployment,
  3. cache de edge/browser.
