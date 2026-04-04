# Worker Queue

Processa jobs da fila `dora-image-jobs` (BullMQ).

## Fase 3 (MVP)
- Consome job da fila
- Busca próxima `image_task` pendente/rejeitada
- Baixa imagem base + referência no Google Drive
- Executa adapter (GPT / NanoBanana via feature-flag)
- Salva resultado temporário em `output_temp_url`
- Marca task como `generated`
- Retry automático de falha IA (1x)
- Registro em `processing_logs`

## Variáveis necessárias
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `REDIS_URL` (default `redis://127.0.0.1:6379`)
- `QUEUE_NAME` (default `dora-image-jobs`)
