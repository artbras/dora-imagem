# Backend API

## Endpoints Fase 1
- `GET /health`
- `GET /auth/google?email=`
- `GET /auth/callback?code=&state=`
- `GET /drive/files?folderId=&email=&pageSize=`

## Requisitos
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `ADMIN_EMAIL` (opcional)

## Banco
Executar migration em `codigo/infra/sql/001_user_google_tokens.sql` no Supabase SQL Editor.
