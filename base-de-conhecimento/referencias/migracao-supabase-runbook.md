# Runbook — Migração do Dora-imagem (Supabase Cloud → Supabase Auto-hospedado)

## Objetivo
Migrar o projeto **Dora-imagem** do Supabase Cloud para uma instância Supabase auto-hospedada, com risco controlado, rollback definido e validação fim a fim.

---

## Escopo da migração

### Dentro do escopo (obrigatório)
- Banco Postgres (schema + dados)
- Configuração de Auth (JWT/SMTP/providers/redirects)
- Storage (buckets + objetos + policies)
- Edge Functions e secrets
- Variáveis de ambiente do frontend/backend/worker
- Cutover com janela curta + rollback

### Fora do escopo (não automatizado por dump SQL)
- DNS/TLS global da VPS
- Hardening de host (firewall/monitoramento)
- Ajustes avançados de observabilidade

---

## Referências no repositório
- Script de migração de banco: `codigo/scripts/migrate-supabase-instance.sh`
- Estado atual do projeto: `base-de-conhecimento/referencias/estado-atual-2026-04-07.md`
- Infra local (base): `codigo/infra/docker-compose.yml`

---

## Pré-requisitos

## 1) Infra destino pronta (Supabase self-hosted)
- VPS com recursos mínimos adequados (CPU/RAM/SSD)
- Stack Supabase operacional (Studio/API/Auth/Storage/Realtime/Postgres)
- TLS ativo (domínio do Supabase destino)
- Backups automáticos habilitados (snapshot + retenção)
- Acesso admin ao painel e ao Postgres destino

## 2) Ferramentas locais
- `pg_dump`, `pg_restore`, `psql`
- Acesso de rede às duas instâncias
- Credenciais seguras da origem e destino

## 3) Congelamento de mudanças (freeze)
- Durante a janela de corte, **não** fazer deploy de código no Dora-imagem
- Evitar gravações concorrentes no banco de origem no momento do dump final

---

## Inventário (checklist antes de mexer)

## Banco
- [ ] Listar tabelas críticas: `public.jobs`, `public.image_tasks`, `public.app_config`
- [ ] Confirmar extensions usadas
- [ ] Confirmar functions/triggers custom

## Auth
- [ ] Confirmar `JWT_SECRET` e expiração
- [ ] Confirmar SMTP e templates de email
- [ ] Confirmar providers (se houver OAuth)
- [ ] Confirmar URLs de redirect

## Storage
- [ ] Listar buckets
- [ ] Medir volume total e quantidade de objetos
- [ ] Revisar policies públicas/privadas

## Functions/Secrets
- [ ] Mapear Edge Functions usadas
- [ ] Exportar lista de secrets/env vars

## App
- [ ] Mapear `.env` de frontend/backend/worker
- [ ] Identificar onde trocar `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SERVICE_ROLE_KEY`

---

## Plano de execução (ordem recomendada)

## Fase A — Backup e snapshot de segurança
1. Gerar backup lógico completo da origem (pré-corte).
2. Snapshot da VPS destino (se já em produção).
3. Salvar backups em local externo (não apenas no mesmo disco da VPS).

**Critério para avançar:** backup validado e recuperável.

---

## Fase B — Migração do banco (schema + dados)
Usar o script oficial do projeto.

```bash
cd /root/.openclaw/workspace/Dora-imagem/codigo

SOURCE_DB_URL='postgresql://<origem-cloud>' \
TARGET_DB_URL='postgresql://<destino-selfhosted>' \
./scripts/migrate-supabase-instance.sh
```

O script executa:
1. Precheck origem
2. Dump schema
3. Dump dados (`public`)
4. Precheck destino
5. Restore schema (`--clean --if-exists`)
6. Restore dados
7. Ajuste de sequences
8. Pós-check com contagens

**Critério para avançar:** script finalizado com `[OK]` e sem erro de restore.

---

## Fase C — Auth no destino
No Supabase auto-hospedado, configurar:
- JWT secret e parâmetros de sessão
- SMTP (host, porta, usuário, senha, remetente)
- Redirect URLs (frontend produção/preview)
- Providers OAuth (se usados)

**Teste rápido:**
- Login/logout
- Recuperação de senha
- Refresh de sessão

---

## Fase D — Storage
1. Recriar buckets no destino (mesmos nomes/policies).
2. Migrar objetos (origem → destino) preservando paths.
3. Validar acessos públicos/assinados.

**Teste rápido:** upload e leitura de arquivo em bucket crítico.

---

## Fase E — Edge Functions + Secrets
1. Publicar funções no destino.
2. Inserir secrets/env vars.
3. Validar CORS e permissões.

**Teste rápido:** chamada real de cada função crítica usada pelo Dora-imagem.

---

## Fase F — Cutover da aplicação
Atualizar variáveis do Dora-imagem:
- Frontend: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- Backend/Worker: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (ou equivalentes)

Deploy coordenado (frontend + backend + worker), depois smoke test.

---

## Validação funcional (Dora-imagem)
Executar obrigatoriamente após o cutover:
- [ ] Login admin funcionando
- [ ] Leitura das pastas Base/Referência do Drive
- [ ] Geração de imagem via GPT
- [ ] Geração de imagem via Nano Banana
- [ ] Aprovação/recusa funcionando
- [ ] Salvamento em `Resultados` com padrão `<base>+<referencia>.webp`
- [ ] Sequência automática sem duplicidade
- [ ] Job finalizando com status `completed`

---

## Rollback (se falhar qualquer etapa crítica)

## Condições de rollback imediato
- Falha de login/refresh generalizada
- Falha em gravação de tarefas/imagens
- Falha em storage que bloqueie operação
- Erro de edge function crítica sem correção rápida

## Passos de rollback
1. Reverter variáveis da aplicação para Supabase Cloud.
2. Re-deploy frontend/backend/worker com variáveis antigas.
3. Validar fluxo ponta a ponta no ambiente Cloud.
4. Congelar alterações no self-hosted para análise.
5. Abrir relatório de causa raiz antes de nova tentativa.

**RTO alvo:** < 30 min

---

## Janela sugerida
- Fazer a virada em horário de menor tráfego.
- Reservar janela de 60–120 min com responsável técnico online.
- Manter período de observação pós-cutover (mínimo 24h).

---

## Critérios de sucesso (go/no-go)

### GO
- Banco restaurado e íntegro
- Auth ok
- Storage ok
- Functions ok
- Smoke/fluxo fim a fim ok

### NO-GO
- Qualquer falha em autenticação, persistência principal ou geração/salvamento de imagem

---

## Pós-migração (D+1)
- Revisar logs de erro e latência
- Confirmar ausência de filas presas/duplicidades
- Confirmar consistência de dados novos no destino
- Registrar lições aprendidas em `dados-historico/`

---

## Comando de referência (execução padrão)
```bash
cd /root/.openclaw/workspace/Dora-imagem/codigo
SOURCE_DB_URL='postgresql://<origem-cloud>' \
TARGET_DB_URL='postgresql://<destino-selfhosted>' \
MIGRATION_DIR='./tmp/migration-$(date +%Y%m%d-%H%M)' \
./scripts/migrate-supabase-instance.sh
```
