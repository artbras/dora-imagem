# 2026-05-01 — Mapeamento EasyPanel/Domínios (Dora-imagem)

## Objetivo
Documentar de forma permanente os domínios identificados no host com EasyPanel e o vínculo com o stack Dora.

## Resultado
- Domínio base do EasyPanel identificado: `xhtfrz.easypanel.host`
- Subdomínios EasyPanel detectados:
  - `adoromimo-evolution-api.xhtfrz.easypanel.host`
  - `adoromimo-n8n.xhtfrz.easypanel.host`
- Domínios custom confirmados no host:
  - `dora.adoromimos.com.br`
  - `api.dora.adoromimos.com.br`
  - `n8n.adoromimos.com.br`

## Fontes técnicas usadas
- `/etc/easypanel/traefik/acme.json`
- `/etc/easypanel/traefik/config/main.yaml`
- `/etc/easypanel/traefik/config/dora-api.yml`
- `/etc/easypanel/traefik/config/dora-imgops.yml`
- `/opt/dora-imagem/dora-stack.yml`

## Documento principal criado
- `base-de-conhecimento/mapa-servicos-dominios-traefik.md`
