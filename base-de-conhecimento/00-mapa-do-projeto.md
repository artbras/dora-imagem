# 00 — Mapa do Projeto (Dora-imagem)

## Objetivo
Orientação rápida da estrutura do projeto para reduzir perda de contexto entre sessões.

## Estrutura esperada
- `codigo/` → código-fonte principal
- `base-de-conhecimento/` → documentação funcional/técnica
- `dados-historico/` → histórico por data
- `secrets/` → segredos locais (quando existir; não versionar)

## Caminhos deste projeto
- Raiz: `Dora-imagem/`
- Código: `Dora-imagem/codigo/` (ou app principal equivalente)
- Documentação: `Dora-imagem/base-de-conhecimento/`
- Histórico: `Dora-imagem/dados-historico/`

## Checklist de abertura de sessão
1. Ler README do projeto (se existir)
2. Ler este arquivo
3. Ler último arquivo de `dados-historico/`
4. Confirmar escopo da tarefa e ambiente alvo

## Checklist de fechamento
1. Atualizar `dados-historico/`
2. Atualizar docs impactadas
3. Commit + push (quando houver repositório remoto)
4. Registrar pendências
