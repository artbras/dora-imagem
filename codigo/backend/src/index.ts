import 'dotenv/config'
import Fastify from 'fastify'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

type TokenRow = {
  email: string
  access_token: string | null
  refresh_token: string
  expiry_date: string | null
}

const envSchema = z.object({
  PORT: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ADMIN_EMAIL: z.string().email().optional(),
})

const env = envSchema.parse(process.env)

const app = Fastify({ logger: true })

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const oauth2Client = new google.auth.OAuth2(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_REDIRECT_URI,
)

function getAuthUrl(state: string) {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/drive.file'],
    state,
  })
}

function normalizeEmail(email?: string) {
  return String(email || '').trim().toLowerCase()
}

async function loadTokenByEmail(email: string): Promise<TokenRow | null> {
  const { data, error } = await supabase
    .from('user_google_tokens')
    .select('email,access_token,refresh_token,expiry_date')
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

app.get('/health', async () => ({ ok: true, service: 'backend' }))

app.get('/auth/google', async (request, reply) => {
  const q = z
    .object({
      email: z.string().email().optional(),
    })
    .parse(request.query)

  const email = normalizeEmail(q.email || env.ADMIN_EMAIL)
  if (!email) {
    return reply.code(400).send({ ok: false, error: 'email obrigatorio (query ou ADMIN_EMAIL)' })
  }

  const state = Buffer.from(JSON.stringify({ email }), 'utf8').toString('base64url')
  const authUrl = getAuthUrl(state)
  return reply.redirect(authUrl)
})

app.get('/auth/callback', async (request, reply) => {
  const q = z
    .object({
      code: z.string().min(1),
      state: z.string().min(1),
    })
    .parse(request.query)

  const state = JSON.parse(Buffer.from(q.state, 'base64url').toString('utf8')) as { email?: string }
  const email = normalizeEmail(state.email)
  if (!email) return reply.code(400).send({ ok: false, error: 'state/email invalido' })

  const tokenResponse = await oauth2Client.getToken(q.code)
  const tokens = tokenResponse.tokens

  if (!tokens.refresh_token) {
    const old = await loadTokenByEmail(email)
    if (!old?.refresh_token) {
      return reply.code(400).send({ ok: false, error: 'refresh_token ausente; refaca consentimento' })
    }
    tokens.refresh_token = old.refresh_token
  }

  await saveTokens(email, tokens)

  return reply.send({ ok: true, email, message: 'Google OAuth conectado com sucesso' })
})

app.get('/drive/files', async (request, reply) => {
  const q = z
    .object({
      folderId: z.string().min(1),
      email: z.string().email().optional(),
      pageSize: z.coerce.number().int().min(1).max(200).default(50),
    })
    .parse(request.query)

  const email = normalizeEmail(q.email || env.ADMIN_EMAIL)
  if (!email) {
    return reply.code(400).send({ ok: false, error: 'email obrigatorio (query ou ADMIN_EMAIL)' })
  }

  const tokenRow = await loadTokenByEmail(email)
  if (!tokenRow) {
    return reply.code(404).send({ ok: false, error: 'tokens Google nao encontrados para este email' })
  }

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

  // após possíveis refreshes automáticos do client, persiste tokens atualizados
  const refreshed = oauth2Client.credentials
  if (refreshed?.refresh_token || refreshed?.access_token) {
    await saveTokens(email, {
      ...refreshed,
      refresh_token: refreshed.refresh_token ?? tokenRow.refresh_token,
    })
  }

  return reply.send({
    ok: true,
    files: result.data.files || [],
    nextPageToken: result.data.nextPageToken || null,
  })
})

const port = Number(env.PORT || 8787)
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err)
  process.exit(1)
})
