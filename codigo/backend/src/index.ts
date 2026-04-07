import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { Queue } from 'bullmq'
import { Readable } from 'node:stream'
import sharp from 'sharp'

type TokenRow = {
  email: string
  access_token: string | null
  refresh_token: string
  expiry_date: string | null
  scope?: string | null
}

type JobRow = {
  id: string
  user_email: string
  status: 'pending' | 'processing' | 'completed'
  model: 'gpt' | 'nano_banana'
  reference_image_id: string
  base_image_ids: string[]
  current_index: number
  created_at: string
}

type AuthUser = {
  id: string
  email: string
}

const envSchema = z.object({
  PORT: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ADMIN_EMAIL: z.string().email().optional(),
  GOOGLE_DRIVE_RESULTS_FOLDER_ID: z.string().min(1),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  QUEUE_NAME: z.string().default('dora-image-jobs'),
})

const env = envSchema.parse(process.env)

const app = Fastify({ logger: true })

await app.register(cors, {
  origin: [
    'https://dora.adoromimos.com.br',
    'https://dora-imagem-frontend.vercel.app',
    'http://localhost:5173',
  ],
  credentials: true,
})

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const queue = new Queue(env.QUEUE_NAME, { connection: { url: env.REDIS_URL } })

const oauth2Client = new google.auth.OAuth2(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_REDIRECT_URI,
)

function getAuthUrl(state: string) {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: false,
    scope: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/drive',
    ],
    state,
  })
}

function normalizeEmail(email?: string) {
  return String(email || '').trim().toLowerCase()
}

function resolveUserEmail(rawEmail?: string) {
  return normalizeEmail(rawEmail || env.ADMIN_EMAIL)
}

function sanitizeFileBaseName(name?: string) {
  return String(name || 'arquivo')
    .replace(/\.[^/.]+$/, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'arquivo'
}

async function authenticateRequest(request: any, reply: any): Promise<AuthUser | null> {
  const authHeader = String(request.headers?.authorization || '')
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) {
    reply.code(401).send({ ok: false, error: 'unauthorized: missing bearer token' })
    return null
  }

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user?.email) {
    reply.code(401).send({ ok: false, error: 'unauthorized: invalid token' })
    return null
  }

  const userEmail = normalizeEmail(data.user.email)
  const adminEmail = normalizeEmail(env.ADMIN_EMAIL)
  if (adminEmail && userEmail !== adminEmail) {
    reply.code(403).send({ ok: false, error: 'forbidden: admin access required' })
    return null
  }

  return { id: data.user.id, email: userEmail }
}

async function enqueueJobProcessing(jobId: string) {
  await queue.add('process-job', { jobId }, { removeOnComplete: 100, removeOnFail: 1000 })
}

async function loadTokenByEmail(email: string): Promise<TokenRow | null> {
  const { data, error } = await supabase
    .from('user_google_tokens')
    .select('email,access_token,refresh_token,expiry_date,scope')
    .eq('email', email)
    .maybeSingle()

  if (error) throw error
  return (data as TokenRow | null) ?? null
}

async function saveTokens(email: string, tokens: any) {
  const payload = {
    email,
    access_token: tokens.access_token ?? null,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    scope: tokens.scope ?? null,
    token_type: tokens.token_type ?? null,
  }

  const { error } = await supabase.from('user_google_tokens').upsert(payload, { onConflict: 'email' })
  if (error) throw error
}

async function updateJobProgress(jobId: string) {
  const { data: tasks, error } = await supabase
    .from('image_tasks')
    .select('id,status,position')
    .eq('job_id', jobId)
    .order('position', { ascending: true })

  if (error) throw error

  const list = tasks || []
  const approvedCount = list.filter((t: any) => t.status === 'approved').length
  const hasOpen = list.some((t: any) => ['pending', 'generated', 'rejected'].includes(String(t.status)))
  const nextOpen = list.find((t: any) => ['pending', 'generated', 'rejected'].includes(String(t.status)))
  const nextIndex = nextOpen ? Number(nextOpen.position || approvedCount) : approvedCount
  const nextStatus: JobRow['status'] = hasOpen ? 'processing' : 'completed'

  const { error: updateError } = await supabase
    .from('jobs')
    .update({ status: nextStatus, current_index: nextIndex })
    .eq('id', jobId)

  if (updateError) throw updateError
}

app.get('/health', async () => ({ ok: true, service: 'backend' }))

app.get('/auth/google', async (request, reply) => {
  const q = z.object({ email: z.string().email().optional(), returnTo: z.string().url().optional() }).parse(request.query)
  const email = resolveUserEmail(q.email)
  if (!email) return reply.code(400).send({ ok: false, error: 'email obrigatorio (query ou ADMIN_EMAIL)' })

  const adminEmail = normalizeEmail(env.ADMIN_EMAIL)
  if (adminEmail && email !== adminEmail) {
    return reply.code(403).send({ ok: false, error: 'forbidden: admin access required' })
  }

  const state = Buffer.from(JSON.stringify({ email, returnTo: q.returnTo || null }), 'utf8').toString('base64url')
  return reply.redirect(getAuthUrl(state))
})

app.get('/auth/callback', async (request, reply) => {
  const q = z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(request.query)
  const state = JSON.parse(Buffer.from(q.state, 'base64url').toString('utf8')) as { email?: string; returnTo?: string | null }
  const email = normalizeEmail(state.email)
  if (!email) return reply.code(400).send({ ok: false, error: 'state/email invalido' })

  const tokenResponse = await oauth2Client.getToken(q.code)
  const tokens = tokenResponse.tokens

  if (!tokens.refresh_token) {
    const old = await loadTokenByEmail(email)
    if (!old?.refresh_token) return reply.code(400).send({ ok: false, error: 'refresh_token ausente; refaca consentimento' })
    tokens.refresh_token = old.refresh_token
  }

  await saveTokens(email, tokens)

  if (state.returnTo) {
    const url = new URL(state.returnTo)
    url.searchParams.set('drive', 'connected')
    return reply.redirect(url.toString())
  }

  return reply.send({ ok: true, email, message: 'Google OAuth conectado com sucesso' })
})

app.get('/auth/drive-status', async (request, reply) => {
  const auth = await authenticateRequest(request, reply)
  if (!auth) return

  const q = z.object({ email: z.string().email().optional() }).parse(request.query)
  const email = resolveUserEmail(q.email || auth.email)
  if (!email) return reply.code(400).send({ ok: false, error: 'email obrigatorio' })

  const tokenRow = await loadTokenByEmail(email)
  return reply.send({ ok: true, connected: Boolean(tokenRow?.refresh_token), scope: tokenRow ? (tokenRow as any).scope || null : null })
})

app.get('/drive/thumbnail', async (request, reply) => {
  // endpoint de imagem usado por <img>, então não pode depender de Authorization header
  const q = z.object({
    fileId: z.string().min(1),
    email: z.string().email().optional(),
  }).parse(request.query)

  const email = resolveUserEmail(q.email)
  if (!email) return reply.code(400).send({ ok: false, error: 'email obrigatorio' })

  const adminEmail = normalizeEmail(env.ADMIN_EMAIL)
  if (adminEmail && email !== adminEmail) {
    return reply.code(403).send({ ok: false, error: 'forbidden: admin access required' })
  }

  const tokenRow = await loadTokenByEmail(email)
  if (!tokenRow) return reply.code(404).send({ ok: false, error: 'tokens Google nao encontrados para este email' })

  oauth2Client.setCredentials({
    access_token: tokenRow.access_token ?? undefined,
    refresh_token: tokenRow.refresh_token,
    expiry_date: tokenRow.expiry_date ? new Date(tokenRow.expiry_date).getTime() : undefined,
  })

  const drive = google.drive({ version: 'v3', auth: oauth2Client })

  try {
    const fileMeta = await drive.files.get({
      fileId: q.fileId,
      fields: 'id,name,mimeType,thumbnailLink',
      supportsAllDrives: true,
    })

    const mimeType = String(fileMeta.data.mimeType || '')

    if (mimeType.startsWith('image/')) {
      const media = await drive.files.get(
        { fileId: q.fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer' },
      )
      const buf = Buffer.from(media.data as ArrayBuffer)
      reply.header('content-type', mimeType || 'image/jpeg')
      reply.header('cache-control', 'public, max-age=86400, stale-while-revalidate=604800')
      return reply.send(buf)
    }

    const thumbLink = fileMeta.data.thumbnailLink
    if (thumbLink) {
      const r = await fetch(thumbLink)
      const ab = await r.arrayBuffer()
      reply.header('content-type', r.headers.get('content-type') || 'image/jpeg')
      reply.header('cache-control', 'public, max-age=86400, stale-while-revalidate=604800')
      return reply.send(Buffer.from(ab))
    }

    return reply.code(404).send({ ok: false, error: 'thumbnail indisponivel' })
  } catch (err: any) {
    return reply.code(500).send({ ok: false, error: err?.message || 'erro ao gerar thumbnail' })
  }
})

app.get('/drive/files', async (request, reply) => {
  const auth = await authenticateRequest(request, reply)
  if (!auth) return

  const q = z.object({
    folderId: z.string().min(1),
    email: z.string().email().optional(),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  }).parse(request.query)

  const email = resolveUserEmail(q.email || auth.email)
  if (!email) return reply.code(400).send({ ok: false, error: 'email obrigatorio (query ou ADMIN_EMAIL)' })

  const tokenRow = await loadTokenByEmail(email)
  if (!tokenRow) return reply.code(404).send({ ok: false, error: 'tokens Google nao encontrados para este email' })

  oauth2Client.setCredentials({
    access_token: tokenRow.access_token ?? undefined,
    refresh_token: tokenRow.refresh_token,
    expiry_date: tokenRow.expiry_date ? new Date(tokenRow.expiry_date).getTime() : undefined,
  })

  const drive = google.drive({ version: 'v3', auth: oauth2Client })
  const result = await drive.files.list({
    q: `'${q.folderId}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,createdTime,modifiedTime,size,webViewLink),nextPageToken',
    pageSize: q.pageSize,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  })

  const refreshed = oauth2Client.credentials
  if (refreshed?.refresh_token || refreshed?.access_token) {
    await saveTokens(email, { ...refreshed, refresh_token: refreshed.refresh_token ?? tokenRow.refresh_token })
  }

  return reply.send({ ok: true, files: result.data.files || [], nextPageToken: result.data.nextPageToken || null })
})

app.post('/jobs', async (request, reply) => {
  const auth = await authenticateRequest(request, reply)
  if (!auth) return

  const body = z.object({
    baseImageIds: z.array(z.string().min(1)).min(1),
    referenceImageId: z.string().min(1),
    model: z.enum(['gpt', 'nano_banana']).default('gpt'),
    email: z.string().email().optional(),
  }).parse(request.body)

  const email = resolveUserEmail(body.email || auth.email)
  if (!email) return reply.code(400).send({ ok: false, error: 'email obrigatorio (body.email ou ADMIN_EMAIL)' })

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .insert({
      user_email: email,
      status: 'pending',
      model: body.model,
      reference_image_id: body.referenceImageId,
      base_image_ids: body.baseImageIds,
      current_index: 0,
    })
    .select('*')
    .single()

  if (jobError) return reply.code(500).send({ ok: false, error: jobError.message })

  const tasksPayload = body.baseImageIds.map((baseImageId, position) => ({
    job_id: job.id,
    base_image_id: baseImageId,
    status: 'pending',
    attempts: 0,
    position,
  }))

  const { error: taskError } = await supabase.from('image_tasks').insert(tasksPayload)
  if (taskError) return reply.code(500).send({ ok: false, error: taskError.message })

  return reply.code(201).send({ ok: true, job: { id: job.id, status: job.status, model: job.model, total: body.baseImageIds.length } })
})

app.get('/jobs/:id', async (request, reply) => {
  const auth = await authenticateRequest(request, reply)
  if (!auth) return

  const params = z.object({ id: z.string().uuid() }).parse(request.params)

  const { data: job, error: jobError } = await supabase.from('jobs').select('*').eq('id', params.id).maybeSingle()
  if (jobError) return reply.code(500).send({ ok: false, error: jobError.message })
  if (!job) return reply.code(404).send({ ok: false, error: 'job nao encontrado' })

  const { data: tasks, error: tasksError } = await supabase
    .from('image_tasks')
    .select('id,base_image_id,output_image_id,status,attempts,position,created_at,updated_at')
    .eq('job_id', params.id)
    .order('position', { ascending: true })

  if (tasksError) return reply.code(500).send({ ok: false, error: tasksError.message })

  const { data: generatedTask } = await supabase
    .from('image_tasks')
    .select('id,output_temp_url')
    .eq('job_id', params.id)
    .eq('status', 'generated')
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle()

  const tasksWithPreview = (tasks || []).map((t: any) =>
    generatedTask && t.id === generatedTask.id ? { ...t, output_temp_url: generatedTask.output_temp_url } : t,
  )

  const total = (tasks || []).length
  const approved = (tasks || []).filter((t: any) => t.status === 'approved').length
  const generated = (tasks || []).filter((t: any) => t.status === 'generated').length
  const pending = (tasks || []).filter((t: any) => t.status === 'pending').length
  const rejected = (tasks || []).filter((t: any) => t.status === 'rejected').length
  const progressPct = total > 0 ? Math.round((approved / total) * 100) : 0

  return reply.send({ ok: true, job, progress: { total, approved, generated, pending, rejected, progressPct }, tasks: tasksWithPreview || [] })
})

app.post('/jobs/:id/start', async (request, reply) => {
  const auth = await authenticateRequest(request, reply)
  if (!auth) return

  const params = z.object({ id: z.string().uuid() }).parse(request.params)

  const { data: job, error: jobError } = await supabase.from('jobs').select('id,status').eq('id', params.id).maybeSingle()
  if (jobError) return reply.code(500).send({ ok: false, error: jobError.message })
  if (!job) return reply.code(404).send({ ok: false, error: 'job nao encontrado' })

  if (job.status !== 'completed') {
    const { error: updateError } = await supabase.from('jobs').update({ status: 'processing' }).eq('id', params.id)
    if (updateError) return reply.code(500).send({ ok: false, error: updateError.message })
    await enqueueJobProcessing(params.id)
  }

  return reply.send({ ok: true, message: 'job enfileirado para processamento', status: job.status === 'completed' ? 'completed' : 'processing' })
})

app.post('/tasks/:id/approve', async (request, reply) => {
  const auth = await authenticateRequest(request, reply)
  if (!auth) return

  const params = z.object({ id: z.string().uuid() }).parse(request.params)
  const body = z.object({ outputImageId: z.string().optional(), outputTempUrl: z.string().optional() }).parse(request.body ?? {})

  const { data: task, error: taskError } = await supabase
    .from('image_tasks')
    .select('id,job_id,position,base_image_id,status,output_temp_url,output_image_id')
    .eq('id', params.id)
    .maybeSingle()
  if (taskError) return reply.code(500).send({ ok: false, error: taskError.message })
  if (!task) return reply.code(404).send({ ok: false, error: 'task nao encontrada' })

  if (task.status === 'approved' && task.output_image_id) {
    await updateJobProgress(task.job_id)
    return reply.send({ ok: true, message: 'task já aprovada (idempotente)', outputImageId: task.output_image_id })
  }

  const { data: jobRow, error: jobError } = await supabase
    .from('jobs')
    .select('id,user_email,reference_image_id')
    .eq('id', task.job_id)
    .maybeSingle()
  if (jobError) return reply.code(500).send({ ok: false, error: jobError.message })
  if (!jobRow) return reply.code(404).send({ ok: false, error: 'job nao encontrado' })

  let outputImageId = body.outputImageId || null
  const tempUrl = body.outputTempUrl || task.output_temp_url || null

  if (!outputImageId && tempUrl && tempUrl.startsWith('data:')) {
    const tokenRow = await loadTokenByEmail(jobRow.user_email)
    if (!tokenRow) return reply.code(404).send({ ok: false, error: 'tokens Google nao encontrados para este email' })

    oauth2Client.setCredentials({
      access_token: tokenRow.access_token ?? undefined,
      refresh_token: tokenRow.refresh_token,
      expiry_date: tokenRow.expiry_date ? new Date(tokenRow.expiry_date).getTime() : undefined,
    })

    const match = tempUrl.match(/^data:(.*?);base64,(.*)$/)
    if (match) {
      const bytes = Buffer.from(match[2], 'base64')
      const drive = google.drive({ version: 'v3', auth: oauth2Client })

      const [baseMeta, refMeta] = await Promise.all([
        drive.files.get({
          fileId: String((task as any).base_image_id || ''),
          fields: 'name',
          supportsAllDrives: true,
        }).catch(() => ({ data: { name: `base-${task.position}` } as any })),
        drive.files.get({
          fileId: String((jobRow as any).reference_image_id || ''),
          fields: 'name',
          supportsAllDrives: true,
        }).catch(() => ({ data: { name: 'referencia' } as any })),
      ])

      const baseName = sanitizeFileBaseName((baseMeta as any)?.data?.name)
      const refName = sanitizeFileBaseName((refMeta as any)?.data?.name)
      const fileName = `${baseName}+${refName}.webp`

      const webpBytes = await sharp(bytes).webp({ quality: 92 }).toBuffer()

      const uploadRes = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [env.GOOGLE_DRIVE_RESULTS_FOLDER_ID],
          mimeType: 'image/webp',
        },
        media: {
          mimeType: 'image/webp',
          body: Readable.from(webpBytes),
        },
        fields: 'id,name',
        supportsAllDrives: true,
      })

      outputImageId = uploadRes.data.id || null

      const refreshed = oauth2Client.credentials
      if (refreshed?.refresh_token || refreshed?.access_token) {
        await saveTokens(jobRow.user_email, {
          ...refreshed,
          refresh_token: refreshed.refresh_token ?? tokenRow.refresh_token,
        })
      }
    }
  }

  const { error: updateError } = await supabase
    .from('image_tasks')
    .update({ status: 'approved', output_image_id: outputImageId, output_temp_url: tempUrl })
    .eq('id', params.id)

  if (updateError) return reply.code(500).send({ ok: false, error: updateError.message })

  await updateJobProgress(task.job_id)
  await enqueueJobProcessing(task.job_id)

  return reply.send({ ok: true, message: 'task aprovada', outputImageId })
})

app.post('/tasks/:id/reject', async (request, reply) => {
  const auth = await authenticateRequest(request, reply)
  if (!auth) return

  const params = z.object({ id: z.string().uuid() }).parse(request.params)

  const { data: task, error: taskError } = await supabase.from('image_tasks').select('id,job_id,attempts').eq('id', params.id).maybeSingle()
  if (taskError) return reply.code(500).send({ ok: false, error: taskError.message })
  if (!task) return reply.code(404).send({ ok: false, error: 'task nao encontrada' })

  const { error: updateError } = await supabase
    .from('image_tasks')
    .update({ status: 'rejected', attempts: Number(task.attempts || 0) + 1 })
    .eq('id', params.id)

  if (updateError) return reply.code(500).send({ ok: false, error: updateError.message })

  await updateJobProgress(task.job_id)
  await enqueueJobProcessing(task.job_id)

  return reply.send({ ok: true, message: 'task rejeitada e re-enfileirada', attempts: Number(task.attempts || 0) + 1 })
})

const CONFIG_SINGLETON_ID = '00000000-0000-0000-0000-000000000001'

app.get('/config', async (request, reply) => {
  const auth = await authenticateRequest(request, reply)
  if (!auth) return

  let { data, error } = await supabase
    .from('app_config')
    .select('id,prompt_positive,prompt_negative,default_model,feature_nano_banana,created_at')
    .eq('id', CONFIG_SINGLETON_ID)
    .maybeSingle()

  if (error) return reply.code(500).send({ ok: false, error: error.message })

  // fallback para legado (linhas antigas)
  if (!data) {
    const fallback = await supabase
      .from('app_config')
      .select('id,prompt_positive,prompt_negative,default_model,feature_nano_banana,created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (fallback.error) return reply.code(500).send({ ok: false, error: fallback.error.message })
    data = fallback.data
  }

  return reply.send({
    ok: true,
    config: data || {
      id: CONFIG_SINGLETON_ID,
      prompt_positive: '',
      prompt_negative: '',
      default_model: 'gpt',
      feature_nano_banana: false,
    },
  })
})

app.put('/config', async (request, reply) => {
  const auth = await authenticateRequest(request, reply)
  if (!auth) return

  const body = z.object({
    llm: z.enum(['gpt', 'nano_banana']),
    promptPositive: z.string().default(''),
    promptNegative: z.string().default(''),
  }).parse(request.body)

  const payload = {
    id: CONFIG_SINGLETON_ID,
    default_model: body.llm,
    feature_nano_banana: body.llm === 'nano_banana',
    prompt_positive: body.promptPositive,
    prompt_negative: body.promptNegative,
  }

  const { data, error } = await supabase
    .from('app_config')
    .upsert(payload, { onConflict: 'id' })
    .select('id,prompt_positive,prompt_negative,default_model,feature_nano_banana,created_at')
    .single()

  if (error) return reply.code(500).send({ ok: false, error: error.message })
  return reply.send({ ok: true, config: data })
})

const port = Number(env.PORT || 8787)
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err)
  process.exit(1)
})
