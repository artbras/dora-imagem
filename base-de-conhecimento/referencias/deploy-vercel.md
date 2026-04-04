# Deploy Vercel — Dora-imagem frontend

## Workflow
Arquivo: `.github/workflows/vercel-deploy-cli.yml`

Dispara em:
- push na `main` com mudanças em `codigo/frontend/**`
- execução manual (`workflow_dispatch`)

## Secrets obrigatórios no GitHub (repo: artbras/dora-imagem)
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

## Valores atuais do projeto
- Project URL: `dora-imagem-frontend.vercel.app`
- Root Directory: `codigo/frontend`

## Como testar
1. Commit/push de qualquer alteração em `codigo/frontend`
2. Acompanhar em: GitHub → Actions → "Deploy Vercel (frontend)"
