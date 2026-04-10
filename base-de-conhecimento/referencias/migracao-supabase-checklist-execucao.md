# Checklist Operacional — Migração Dora-imagem (Supabase Cloud → Self-hosted)

## Objetivo
Checklist prática para conduzir a migração com controle de risco em **T-7d, T-1d, T-0 e T+1**.

Referência principal: `base-de-conhecimento/referencias/migracao-supabase-runbook.md`

---

## T-7d (preparação)

## Planejamento
- [ ] Definir janela oficial de migração (data/hora e duração)
- [ ] Nomear responsáveis (DB, app/deploy, validação funcional)
- [ ] Definir canal único de comunicação no dia da virada

## Infra destino
- [ ] Supabase self-hosted estável e acessível por domínio com TLS
- [ ] Backup automático habilitado
- [ ] Monitoramento/logs ativos (Postgres/API/Auth)
- [ ] Teste de conectividade origem/destino concluído

## Inventário técnico
- [ ] Confirmar tabelas críticas: `jobs`, `image_tasks`, `app_config`
- [ ] Mapear Edge Functions e secrets
- [ ] Mapear buckets e policies de storage
- [ ] Consolidar variáveis de ambiente por componente (frontend/backend/worker)

## Segurança e rollback
- [ ] Definir critérios de GO/NO-GO
- [ ] Definir procedimento de rollback (documentado e revisado)
- [ ] Garantir acesso rápido às credenciais antigas (Cloud)

---

## T-1d (ensaio e freeze parcial)

## Ensaios
- [ ] Rodar migração de teste em ambiente de homologação (se disponível)
- [ ] Validar script: `codigo/scripts/migrate-supabase-instance.sh`
- [ ] Medir tempo total do processo (dump + restore + validação)

## Backup
- [ ] Backup lógico recente da origem validado
- [ ] Snapshot da VPS destino pronto para restauração

## App readiness
- [ ] Atualização de envs preparada (sem aplicar)
- [ ] Plano de deploy coordenado pronto (frontend/backend/worker)
- [ ] Testes smoke já roteirizados

## Comunicação
- [ ] Avisar janela de manutenção/risco interno
- [ ] Confirmar disponibilidade de todos os responsáveis no T-0

---

## T-0 (dia da migração)

## 1) Pré-corte
- [ ] Iniciar war room/canal único
- [ ] Ativar freeze de deploy e mudanças
- [ ] Confirmar que não há jobs críticos em execução

## 2) Backup final
- [ ] Executar backup final da origem
- [ ] Confirmar integridade mínima do backup

## 3) Migração de banco
- [ ] Executar:

```bash
cd /root/.openclaw/workspace/Dora-imagem/codigo
SOURCE_DB_URL='postgresql://<origem-cloud>' \
TARGET_DB_URL='postgresql://<destino-selfhosted>' \
MIGRATION_DIR='./tmp/migration-$(date +%Y%m%d-%H%M)' \
./scripts/migrate-supabase-instance.sh
```

- [ ] Conferir pós-check sem erro

## 4) Configuração destino
- [ ] Auth: JWT/SMTP/redirects/providers
- [ ] Storage: buckets + objetos + policies
- [ ] Edge Functions: deploy + secrets + CORS

## 5) Cutover da aplicação
- [ ] Atualizar envs do frontend
- [ ] Atualizar envs do backend
- [ ] Atualizar envs do worker
- [ ] Deploy coordenado realizado

## 6) Validação funcional (obrigatória)
- [ ] Login admin
- [ ] Leitura de pastas Base/Referência no Drive
- [ ] Geração GPT
- [ ] Geração Nano Banana
- [ ] Aprovar/recusar
- [ ] Salvar em `Resultados` (`<base>+<referencia>.webp`)
- [ ] Sequência automática sem duplicidade
- [ ] Job conclui `completed`

## 7) Decisão GO/NO-GO
- [ ] GO: operação segue em self-hosted
- [ ] NO-GO: executar rollback imediato

---

## Rollback rápido (T-0)
- [ ] Reverter envs para Supabase Cloud
- [ ] Re-deploy frontend/backend/worker
- [ ] Revalidar fluxo ponta a ponta no Cloud
- [ ] Registrar incidente + causa raiz preliminar

---

## T+1 (24h pós-cutover)

## Observabilidade
- [ ] Revisar erros (API/Auth/DB/Functions)
- [ ] Revisar latência e throughput
- [ ] Confirmar ausência de filas travadas e duplicidades

## Consistência
- [ ] Conferir novas gravações em `jobs` e `image_tasks`
- [ ] Validar amostra de arquivos salvos no storage/Drive

## Encerramento
- [ ] Confirmar estabilidade por 24h
- [ ] Encerrar janela de migração
- [ ] Registrar lições aprendidas em `dados-historico/`

---

## Critérios objetivos de aceitação
- [ ] 100% dos testes de fluxo crítico aprovados
- [ ] 0 erro bloqueante de autenticação
- [ ] 0 erro bloqueante de geração/salvamento
- [ ] Sem duplicidade de sequência
- [ ] Rollback pronto (mesmo sem uso)
