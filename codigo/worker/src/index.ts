import 'dotenv/config'
import { Queue, Worker, Job } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import OpenAI, { toFile } from 'openai'
import { Redis } from 'ioredis'

type JobPayload = { jobId: string }

type ProcessInput = {
  baseImage: Buffer
  referenceImage: Buffer
  baseMimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  referenceMimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  promptPositive: string
  promptNegative: string
}

interface ImageProcessor {
  generate(params: ProcessInput): Promise<Buffer>
}

class GPTAdapter implements ImageProcessor {
  private client: OpenAI
  private model: string

  constructor(model: string) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY ausente para GPTAdapter')
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    this.model = model
  }

  async generate(params: ProcessInput): Promise<Buffer> {
    const model = this.model
    const baseExt = params.baseMimeType === 'image/jpeg' ? 'jpg' : params.baseMimeType === 'image/webp' ? 'webp' : 'png'
    const refExt = params.referenceMimeType === 'image/jpeg' ? 'jpg' : params.referenceMimeType === 'image/webp' ? 'webp' : 'png'

    const base = await toFile(params.baseImage, `base.${baseExt}`, { type: params.baseMimeType })
    const ref = await toFile(params.referenceImage, `reference.${refExt}`, { type: params.referenceMimeType })

    const prompt = [
      params.promptPositive || 'Substituir o tecido com base na referência.',
      params.promptNegative ? `Evitar: ${params.promptNegative}` : '',
      'Use a primeira imagem como base e a segunda como referência de tecido/estampa.',
      'Manter enquadramento, iluminação e elementos do cenário. Alterar apenas o tecido.',
    ].filter(Boolean).join('\n')

    const result: any = await this.client.images.edit({
      model,
      image: [base, ref] as any,
      prompt,
      size: '1024x1024',
    })

    const b64 = result?.data?.[0]?.b64_json
    if (!b64) throw new Error('OpenAI Images não retornou b64_json')
    return Buffer.from(b64, 'base64')
  }
}

class NanoBananaAdapter implements ImageProcessor {
  private model: string

  constructor(model: string) {
    this.model = model
  }

  async generate(params: ProcessInput): Promise<Buffer> {
    const apiKey = process.env.NANO_BANANA_API_KEY
    if (!apiKey) throw new Error('NANO_BANANA_API_KEY ausente para NanoBananaAdapter')

    const model = this.model

    const prompt = [
      params.promptPositive || 'Substituir o tecido com base na referência.',
      params.promptNegative ? `Evitar: ${params.promptNegative}` : '',
      'Use a primeira imagem como base e a segunda como referência de tecido/estampa.',
      'Manter enquadramento, iluminação e elementos do cenário. Alterar apenas o tecido.',
    ].filter(Boolean).join('\n')

    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType: params.baseMimeType, data: params.baseImage.toString('base64') } },
            { inlineData: { mimeType: params.referenceMimeType, data: params.referenceImage.toString('base64') } },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    }

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const json: any = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = json?.error?.message || `Gemini API error ${res.status}`
      throw new Error(msg)
    }

    const parts = json?.candidates?.[0]?.content?.parts || []
    const imagePart = parts.find((p: any) => p?.inlineData?.data)
    const b64 = imagePart?.inlineData?.data
    if (!b64) throw new Error('Gemini não retornou imagem (inlineData)')

    return Buffer.from(b64, 'base64')
  }
}

function getModelAdapter(model: string, apiModelName: string): ImageProcessor {
  if (model === 'nano_banana') return new NanoBananaAdapter(apiModelName)
  return new GPTAdapter(apiModelName)
}

function detectMimeFromBytes(buf: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length > 11 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return 'image/png'
}

const required = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
] as const

for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing env: ${key}`)
}

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379'
const queueName = process.env.QUEUE_NAME || 'dora-image-jobs'

const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-1.5'
const DEFAULT_GEMINI_IMAGE_MODEL = process.env.NANO_BANANA_MODEL || 'gemini-3-pro-image-preview'
const CFG_OPENAI_MODEL_KEY = 'dora:config:openai_image_model'
const CFG_GEMINI_MODEL_KEY = 'dora:config:gemini_image_model'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const queue = new Queue(queueName, { connection: { url: redisUrl } })
const redis = new Redis(redisUrl)

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI,
)
const drive = google.drive({ version: 'v3', auth: oauth2Client })

async function writeLog(input: {
  jobId: string
  taskId?: string | null
  model?: string | null
  processingTimeMs?: number | null
  attempts?: number | null
  status: string
  message?: string | null
}) {
  await supabase.from('processing_logs').insert({
    job_id: input.jobId,
    task_id: input.taskId ?? null,
    model: input.model ?? null,
    processing_time_ms: input.processingTimeMs ?? null,
    attempts: input.attempts ?? null,
    status: input.status,
    message: input.message ?? null,
  })
}

async function processNextImage(jobId: string) {
  const startedAt = Date.now()
  const { data: appConfig } = await supabase
    .from('app_config')
    .select('prompt_positive,prompt_negative')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const promptPositive = appConfig?.prompt_positive || 'Substituir tecido da cesta preservando composição e iluminação.'
  const promptNegative = appConfig?.prompt_negative || 'Não alterar produtos, enquadramento ou branding.'

  const { data: jobRow, error: jobError } = await supabase
    .from('jobs')
    .select('id,user_email,model,reference_image_id,status')
    .eq('id', jobId)
    .maybeSingle()

  if (jobError) throw jobError
  if (!jobRow) return

  const { data: tokenRow, error: tokenError } = await supabase
    .from('user_google_tokens')
    .select('access_token,refresh_token,expiry_date')
    .eq('email', jobRow.user_email)
    .maybeSingle()

  if (tokenError) throw tokenError
  if (!tokenRow?.refresh_token) throw new Error(`Google tokens ausentes para ${jobRow.user_email}`)

  oauth2Client.setCredentials({
    access_token: tokenRow.access_token ?? undefined,
    refresh_token: tokenRow.refresh_token,
    expiry_date: tokenRow.expiry_date ? new Date(tokenRow.expiry_date).getTime() : undefined,
  })

  const { data: task, error: taskError } = await supabase
    .from('image_tasks')
    .select('id,base_image_id,attempts,position,status')
    .eq('job_id', jobId)
    .in('status', ['pending', 'rejected'])
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (taskError) throw taskError

  if (!task) {
    await supabase.from('jobs').update({ status: 'completed' }).eq('id', jobId)
    return
  }

  try {
    const [baseResp, refResp] = await Promise.all([
      drive.files.get({ fileId: task.base_image_id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' }),
      drive.files.get({ fileId: jobRow.reference_image_id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' }),
    ])

    const baseImage = Buffer.from(baseResp.data as ArrayBuffer)
    const referenceImage = Buffer.from(refResp.data as ArrayBuffer)
    const baseMimeType = detectMimeFromBytes(baseImage)
    const referenceMimeType = detectMimeFromBytes(referenceImage)

    const currentModel = String(jobRow.model || 'gpt')
    const [openaiCfg, geminiCfg] = await redis.mget(CFG_OPENAI_MODEL_KEY, CFG_GEMINI_MODEL_KEY)
    const apiModelName = currentModel === 'nano_banana'
      ? (geminiCfg || DEFAULT_GEMINI_IMAGE_MODEL)
      : (openaiCfg || DEFAULT_OPENAI_IMAGE_MODEL)

    const adapter = getModelAdapter(currentModel, apiModelName)
    const output = await adapter.generate({
      baseImage,
      referenceImage,
      baseMimeType,
      referenceMimeType,
      promptPositive,
      promptNegative,
    })

    const mime = detectMimeFromBytes(output)
    const tempPayload = `data:${mime};base64,${output.toString('base64')}`

    const { error: updateTaskError } = await supabase
      .from('image_tasks')
      .update({ status: 'generated', output_temp_url: tempPayload })
      .eq('id', task.id)

    if (updateTaskError) throw updateTaskError

    await supabase
      .from('jobs')
      .update({ status: 'processing', current_index: Number(task.position || 0) })
      .eq('id', jobId)

    await writeLog({
      jobId,
      taskId: task.id,
      model: String(jobRow.model || 'gpt'),
      processingTimeMs: Date.now() - startedAt,
      attempts: Number(task.attempts || 0),
      status: 'generated',
      message: `task gerada com sucesso | model=${currentModel} | api_model=${apiModelName} | prompt+=${promptPositive.length} chars | prompt-=${promptNegative.length} chars`,
    })

    console.log('[worker] generated task', { jobId, taskId: task.id, position: task.position })
  } catch (error: any) {
    const nextAttempts = Number(task.attempts || 0) + 1

    if (nextAttempts <= 1) {
      await supabase
        .from('image_tasks')
        .update({ status: 'pending', attempts: nextAttempts })
        .eq('id', task.id)

      await writeLog({
        jobId,
        taskId: task.id,
        model: String(jobRow.model || 'gpt'),
        processingTimeMs: Date.now() - startedAt,
        attempts: nextAttempts,
        status: 'retry_scheduled',
        message: String(error?.message || error),
      })

      await queue.add('process-job', { jobId }, { removeOnComplete: 100, removeOnFail: 1000 })
      return
    }

    await supabase
      .from('image_tasks')
      .update({ status: 'rejected', attempts: nextAttempts })
      .eq('id', task.id)

    await writeLog({
      jobId,
      taskId: task.id,
      model: String(jobRow.model || 'gpt'),
      processingTimeMs: Date.now() - startedAt,
      attempts: nextAttempts,
      status: 'failed',
      message: String(error?.message || error),
    })

    throw error
  }
}

new Worker(
  queueName,
  async (job: Job<JobPayload>) => {
    if (!job.data?.jobId) return
    await processNextImage(job.data.jobId)
  },
  { connection: { url: redisUrl } },
)

console.log('[worker] ready', { queueName, redisUrl })
await queue.waitUntilReady()
