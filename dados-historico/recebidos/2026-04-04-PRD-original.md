# 📄 PRD Técnico — Sistema de Alteração de Tecido em Cestas de Café da Manhã com IA

---

## 1. 🧱 Arquitetura do Sistema

### Visão geral

```
Frontend (React)
   ↓
Backend API (Node.js / Python)
   ↓
Orquestrador de Jobs (Queue Worker)
   ↓
Adapters de IA (GPT / Nano Banana)
   ↓
Google Drive API
```

---

## 2. 🔐 Autenticação Google Drive

### Fluxo OAuth 2.0

* Usar **OAuth Authorization Code Flow**
* Escopos mínimos:

  ```
  https://www.googleapis.com/auth/drive.file
  ```

### Passos:

1. Frontend redireciona user para Google
2. User autoriza acesso
3. Backend recebe `authorization_code`
4. Backend troca por:

   * `access_token`
   * `refresh_token`
5. Tokens persistidos no banco

📌 OAuth permite acessar arquivos do usuário sem expor credenciais diretamente 

---

## 3. 🧩 Modelos de Dados

### User

```json
{
  "id": "uuid",
  "email": "string",
  "role": "admin | operator",
  "googleTokens": {
    "accessToken": "string",
    "refreshToken": "string",
    "expiry": "timestamp"
  }
}
```

---

### Job (processamento em lote)

```json
{
  "id": "uuid",
  "userId": "uuid",
  "status": "pending | processing | completed",
  "model": "gpt | nano_banana",
  "referenceImageId": "string",
  "baseImageIds": ["string"],
  "currentIndex": 0,
  "createdAt": "timestamp"
}
```

---

### ImageTask (por imagem)

```json
{
  "id": "uuid",
  "jobId": "uuid",
  "baseImageId": "string",
  "outputImageId": "string",
  "status": "pending | generated | approved | rejected",
  "attempts": 0
}
```

---

### Config (admin)

```json
{
  "promptPositive": "string",
  "promptNegative": "string",
  "defaultModel": "gpt"
}
```

---

## 4. 🔌 APIs (Backend)

### Auth

#### `GET /auth/google`

* Redireciona para OAuth

#### `GET /auth/callback`

* Recebe code
* Salva tokens

---

### Drive

#### `GET /drive/files?folderId=`

* Lista arquivos

---

### Jobs

#### `POST /jobs`

Cria job

```json
{
  "baseImageIds": [],
  "referenceImageId": "",
  "model": "gpt"
}
```

---

#### `GET /jobs/:id`

Retorna status + progresso

---

#### `POST /jobs/:id/start`

Inicia processamento

---

### Tasks

#### `POST /tasks/:id/approve`

* Salva imagem no Drive
* Move para próxima

#### `POST /tasks/:id/reject`

* Incrementa attempts
* Reprocessa automaticamente

---

## 5. ⚙️ Pipeline de Processamento

### Orquestrador (Worker Queue)

Tecnologia sugerida:

* BullMQ / Celery / Sidekiq

---

### Fluxo:

```
START JOB
 ↓
pega próxima imagem (currentIndex)
 ↓
gera imagem IA
 ↓
aguarda aprovação user
 ↓
[approve] → salva + next
[reject] → retry mesma imagem
```

---

## 6. 🤖 Adapter de IA

### Interface padrão

```ts
interface ImageProcessor {
  generate(params: {
    baseImage: Buffer
    referenceImage: Buffer
    promptPositive: string
    promptNegative: string
  }): Promise<Buffer>
}
```

---

### Implementações

#### GPT Adapter

* OpenAI Images API (ou equivalente)

#### Nano Banana Adapter

* Wrapper custom

---

### Seleção dinâmica

```ts
function getModelAdapter(model: string) {
  if (model === "gpt") return new GPTAdapter()
  if (model === "nano_banana") return new NanoBananaAdapter()
}
```

---

## 7. 🔄 Pseudo-código (CORE LOOP)

```ts
async function processNextImage(jobId) {
  const job = await getJob(jobId)

  const task = await getNextPendingTask(job)

  if (!task) {
    markJobComplete(jobId)
    return
  }

  const baseImage = await drive.getFile(task.baseImageId)
  const refImage = await drive.getFile(job.referenceImageId)

  const adapter = getModelAdapter(job.model)

  const output = await adapter.generate({
    baseImage,
    referenceImage: refImage,
    promptPositive: config.promptPositive,
    promptNegative: config.promptNegative
  })

  await saveTempOutput(task.id, output)

  updateTaskStatus(task.id, "generated")
}
```

---

### Aprovação

```ts
async function approveTask(taskId) {
  const task = await getTask(taskId)

  const fileId = await drive.uploadFile(task.outputImage)

  await updateTask(taskId, {
    status: "approved",
    outputImageId: fileId
  })

  await processNextImage(task.jobId)
}
```

---

### Rejeição

```ts
async function rejectTask(taskId) {
  const task = await getTask(taskId)

  await incrementAttempts(taskId)

  await processSameTask(taskId)
}
```

---

## 8. 🖥️ Frontend (Componentes)

### Tela principal

* Select:

  * imagens base (multi-select)
  * imagem referência (single)
  * modelo (dropdown)

* Botão:

  * "Iniciar processamento"

---

### Tela de aprovação

* Preview lado a lado:

  * imagem original
  * imagem gerada

* Botões:

  * ✅ Aprovar
  * ❌ Recusar

* Indicadores:

  * progresso (%)
  * imagem atual / total

---

## 9. 📦 Integração com Google Drive

### Operações necessárias:

* `files.list`
* `files.get`
* `files.create`

📌 Todas chamadas autenticadas via OAuth com access token

---

## 10. 🚀 Estratégia de Execução (IMPORTANTE)

### Sequencial (MVP)

* 1 imagem por vez
* evita custo desnecessário
* mantém controle humano

---

### Retry strategy

* ilimitado (controlado pelo operador)
* opcional: limite futuro (ex: 5 tentativas)

---

## 11. ⚠️ Edge Cases

* Token expirado → refresh automático
* Imagem inválida → pular
* Falha IA → retry automático (1x)
* Usuário fecha tela → job continua pausado

---

## 12. 📊 Logs essenciais

```json
{
  "jobId": "",
  "taskId": "",
  "model": "",
  "processingTimeMs": "",
  "attempts": "",
  "status": ""
}
```

---

## 13. 🔥 Melhorias futuras (já pensadas)

* comparação A/B entre modelos
* ajuste fino de prompt por imagem
* mask automática (garantir só tecido)
* batch paralelo (performance)

---

# ✅ Conclusão

Esse PRD já está:

✔ Executável por dev
✔ Estruturado para IA coder
✔ Com fluxo claro
✔ Com arquitetura escalável
✔ Sem ambiguidade funcional

