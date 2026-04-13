# Registro Operacional — 2026-04-13

## Entregas do dia
- Configuração `/config` evoluída para seleção explícita de modelo por provedor:
  - OpenAI (GPT imagem) via campo select.
  - Google (Gemini imagem) via campo select.
- Regra operacional implementada: o job usa o modelo do provedor selecionado na configuração.
- Frontend atualizado com box de seleção de modelos por provedor.
- Backend/worker atualizados para persistir/consumir os modelos selecionados em runtime.

## Publicação
- Repositório atualizado em `main`.
- Deploy frontend atualizado no Vercel (`https://dora.adoromimos.com.br`).
- Runtime backend/worker atualizado na VPS de produção.

## Acessos e credenciais
- Frontend: `https://dora.adoromimos.com.br`
- Backend/API: `https://api.dora.adoromimos.com.br`
- Health: `https://api.dora.adoromimos.com.br/health`
- Credenciais do projeto centralizadas em `secrets/credentials-production.env` (fora do Git).

## Encerramento
- Projeto Dora-imagem mantido como finalizado/arquivado após ajustes finais solicitados por Arthur.
