import 'dotenv/config'
import { Queue, Worker, Job } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import OpenAI, { toFile } from 'openai'

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

  constructor() {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY ausente para GPTAdapter')
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }

  async generate(params: ProcessInput): Promise<Buffer> {
    const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1'
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
  async generate(params: ProcessInput): Promise<Buffer> {
    const text = `generated:nano_banana:${params.baseImage.length}:${params.referenceImage.length}`
    return Buffer.from(text, 'utf8')
  }
}

function getModelAdapter(model: string, featureNanoBanana: boolean): ImageProcessor {
  if (model === 'nano_banana' && featureNanoBanana) return new NanoBananaAdapter()
  return new GPTAdapter()
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

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const queue = new Queue(queueName, { connection: { url: redisUrl } })

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
    .select('prompt_positive,prompt_negative,feature_nano_banana')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const promptPositive = appConfig?.prompt_positive || 'Substituir tecido da cesta preservando composição e iluminação.'
  const promptNegative = appConfig?.prompt_negative || 'Não alterar produtos, enquadramento ou branding.'
  const featureNanoBanana = Boolean(appConfig?.feature_nano_banana)

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
    const adapter = getModelAdapter(currentModel, featureNanoBanana)
    const output = await adapter.generate({
      baseImage,
      referenceImage,
      baseMimeType,
      referenceMimeType,
      promptPositive,
      promptNegative,
    })

    let tempPayload = ''
    if (currentModel === 'gpt') {
      const mime = detectMimeFromBytes(output)
      tempPayload = `data:${mime};base64,${output.toString('base64')}`
    } else {
      const outputBytes = output.length
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1024' height='1024'>
        <rect width='100%' height='100%' fill='#0b1220'/>
        <rect x='24' y='24' width='976' height='976' rx='24' fill='#111a2b' stroke='#2a3d60'/>
        <text x='64' y='120' fill='#9fd6ff' font-size='44' font-family='Arial'>Prévia gerada (placeholder)</text>
        <text x='64' y='190' fill='#b8c7e6' font-size='28' font-family='Arial'>Modelo: ${currentModel}</text>
        <text x='64' y='240' fill='#b8c7e6' font-size='24' font-family='Arial'>Base bytes: ${baseImage.length}</text>
        <text x='64' y='280' fill='#b8c7e6' font-size='24' font-family='Arial'>Ref bytes: ${referenceImage.length}</text>
        <text x='64' y='320' fill='#b8c7e6' font-size='24' font-family='Arial'>Output bytes: ${outputBytes}</text>
        <text x='64' y='370' fill='#9cffd5' font-size='22' font-family='Arial'>Ao integrar Nano Banana real, este card será a imagem final.</text>
      </svg>`
      tempPayload = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
    }

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
      message: `task gerada com sucesso | model=${currentModel} | prompt+=${promptPositive.length} chars | prompt-=${promptNegative.length} chars`,
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
