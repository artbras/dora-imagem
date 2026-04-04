# Backend API

## Endpoints
### Health
- `GET /health`

### Fase 1 — Auth Google + Drive
- `GET /auth/google?email=`
- `GET /auth/callback?code=&state=`
- `GET /drive/files?folderId=&email=&pageSize=`

### Fase 2 — Jobs/Tasks
- `POST /jobs`
- `GET /jobs/:id`
- `POST /jobs/:id/start`
- `POST /tasks/:id/approve`
- `POST /tasks/:id/reject`

## Requisitos de ambiente
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `ADMIN_EMAIL` (opcional)

## Banco (Supabase SQL Editor)
1. `codigo/infra/sql/001_user_google_tokens.sql`
2. `codigo/infra/sql/002_jobs_tasks_config.sql`
