# 01 — Runbook Operacional (Dora-imagem)

## 1) Início da tarefa
- Definir módulo/área impactada
- Confirmar ambiente (local/preview/produção)
- Verificar risco de regressão

## 2) Execução
- Fazer mudanças incrementais
- Validar fluxo principal da área alterada
- Atualizar documentação junto com a alteração

## 3) Segurança
- Não versionar credenciais
- Não manter token embutido em URL de `git remote`
- Se credencial for exposta, rotacionar e registrar no histórico

## 4) Deploy/Git
- Commit com mensagem objetiva
- Push e validação de deploy quando aplicável

## 5) Encerramento
- Registrar resumo factual em `dados-historico/`
- Listar próximos passos claros
