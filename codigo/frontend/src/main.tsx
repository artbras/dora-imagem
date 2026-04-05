import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createClient, type Session } from '@supabase/supabase-js'

type DriveFile = { id: string; name: string; mimeType?: string }
type JobTask = {
  id: string
  base_image_id: string
  output_image_id?: string | null
  output_temp_url?: string | null
  status: 'pending' | 'generated' | 'approved' | 'rejected'
  attempts: number
  position: number
}

const apiBase = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:8787'
const normalizeEmail = (v?: string | null) => String(v || '').trim().toLowerCase()
const adminEmail = normalizeEmail((import.meta.env.VITE_ADMIN_EMAIL as string) || 'am.agente.ia@gmail.com')
const defaultBaseFolder = (import.meta.env.VITE_GOOGLE_DRIVE_BASE_FOLDER_ID as string) || ''
const defaultRefFolder = (import.meta.env.VITE_GOOGLE_DRIVE_REFERENCE_FOLDER_ID as string) || ''
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) || ''
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || ''

const supabase = createClient(supabaseUrl, supabaseAnonKey)

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState(adminEmail)
  const [baseFolderId, setBaseFolderId] = useState(defaultBaseFolder)
  const [refFolderId, setRefFolderId] = useState(defaultRefFolder)
  const [model, setModel] = useState<'gpt' | 'nano_banana'>('gpt')

  const [baseFiles, setBaseFiles] = useState<DriveFile[]>([])
  const [refFiles, setRefFiles] = useState<DriveFile[]>([])
  const [selectedBaseIds, setSelectedBaseIds] = useState<string[]>([])
  const [referenceImageId, setReferenceImageId] = useState('')

  const [jobId, setJobId] = useState('')
  const [jobStatus, setJobStatus] = useState('')
  const [tasks, setTasks] = useState<JobTask[]>([])
  const [progress, setProgress] = useState<{ total: number; approved: number; progressPct: number } | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const generatedTask = useMemo(() => tasks.find((t) => t.status === 'generated') || null, [tasks])

  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    if (query.get('drive') === 'connected') setMsg('Google Drive conectado com sucesso.')

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      const userEmail = normalizeEmail(data.session?.user?.email)
      if (userEmail && userEmail !== adminEmail) {
        setMsg(`Acesso negado para ${userEmail}. Apenas ${adminEmail} está autorizado.`)
        supabase.auth.signOut()
        setSession(null)
      }
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      const userEmail = normalizeEmail(nextSession?.user?.email)
      if (userEmail && userEmail !== adminEmail) {
        setMsg(`Acesso negado para ${userEmail}. Apenas ${adminEmail} está autorizado.`)
        supabase.auth.signOut()
        setSession(null)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function authHeaders() {
    const token = session?.access_token
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  async function apiGet(path: string) {
    const res = await fetch(`${apiBase}${path}`, { headers: { ...(await authHeaders()) } })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || `Erro ${res.status}`)
    return data
  }

  async function apiPost(path: string, body?: unknown) {
    const res = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || `Erro ${res.status}`)
    return data
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) setMsg(`Erro login Google: ${error.message}`)
  }

  function connectDriveOAuth() {
    const returnTo = encodeURIComponent(window.location.origin)
    window.location.href = `${apiBase}/auth/google?email=${encodeURIComponent(email)}&returnTo=${returnTo}`
  }

  async function loadDriveFiles(type: 'base' | 'ref', silent = false) {
    const folderId = type === 'base' ? baseFolderId : refFolderId
    if (!folderId) return
    setBusy(true)
    try {
      const data = await apiGet(`/drive/files?folderId=${encodeURIComponent(folderId)}&email=${encodeURIComponent(email)}`)
      const files = (data.files || []) as DriveFile[]
      if (type === 'base') setBaseFiles(files)
      else setRefFiles(files)
      if (!silent) setMsg(`Arquivos ${type === 'base' ? 'base' : 'referência'} carregados: ${files.length}`)
    } catch (e: any) {
      if (!silent) setMsg(`Falha ao carregar Drive (${type}): ${String(e?.message || e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function createAndStartJob() {
    if (!selectedBaseIds.length || !referenceImageId) {
      setMsg('Selecione ao menos 1 imagem base e 1 imagem referência.')
      return
    }

    setBusy(true)
    try {
      const created = await apiPost('/jobs', {
        email,
        baseImageIds: selectedBaseIds,
        referenceImageId,
        model,
      })

      setJobId(created.job.id)
      await apiPost(`/jobs/${created.job.id}/start`)
      setJobStatus('processing')
      setMsg(`Job iniciado: ${created.job.id}`)
      await loadJob(created.job.id)
    } catch (e: any) {
      setMsg(`Erro ao iniciar job: ${String(e?.message || e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function loadJob(targetJobId = jobId) {
    if (!targetJobId) return
    try {
      const data = await apiGet(`/jobs/${targetJobId}`)
      setJobStatus(data.job?.status || '')
      setTasks(data.tasks || [])
      setProgress(data.progress || null)
    } catch (e: any) {
      setMsg(`Erro ao carregar job: ${String(e?.message || e)}`)
    }
  }

  async function approveCurrent() {
    if (!generatedTask) return
    setBusy(true)
    try {
      await apiPost(`/tasks/${generatedTask.id}/approve`, { outputTempUrl: generatedTask.output_temp_url })
      setMsg('Imagem aprovada. Processando próxima...')
      await loadJob()
    } catch (e: any) {
      setMsg(`Erro ao aprovar: ${String(e?.message || e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function rejectCurrent() {
    if (!generatedTask) return
    setBusy(true)
    try {
      await apiPost(`/tasks/${generatedTask.id}/reject`)
      setMsg('Imagem recusada. Reprocessando...')
      await loadJob()
    } catch (e: any) {
      setMsg(`Erro ao recusar: ${String(e?.message || e)}`)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!session) return
    if (!baseFolderId || !refFolderId) return
    void Promise.all([
      loadDriveFiles('base', true),
      loadDriveFiles('ref', true),
    ])
    setMsg('Imagens das pastas Base e Referência carregadas automaticamente.')
  }, [session, baseFolderId, refFolderId])

  useEffect(() => {
    if (!jobId) return
    const t = setInterval(() => void loadJob(jobId), 4000)
    return () => clearInterval(t)
  }, [jobId])

  if (!session) {
    return (
      <main className="page auth">
        <section className="card auth-card">
          <h1>Dora-imagem</h1>
          <p>Login obrigatório com Google ({adminEmail})</p>
          <button onClick={signInWithGoogle}>Entrar com Google</button>
          {msg && <p className="msg">{msg}</p>}
        </section>
      </main>
    )
  }

  return (
    <main className="page">
      <header className="topbar">
        <h1>Dora-imagem — Operação</h1>
        <div>
          <span>{session.user.email}</span>
          <button onClick={() => supabase.auth.signOut()}>Sair</button>
        </div>
      </header>

      <section className="card">
        <h3>Segurança e OAuth</h3>
        <p>Conta autorizada: <b>{adminEmail}</b></p>
        <button disabled={busy} onClick={connectDriveOAuth}>Conectar Google Drive</button>
      </section>

      <section className="card">
        <h3>Configuração</h3>
        <div className="grid">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email operador" />
          <input value={baseFolderId} onChange={(e) => setBaseFolderId(e.target.value)} placeholder="Folder ID imagens base" />
          <input value={refFolderId} onChange={(e) => setRefFolderId(e.target.value)} placeholder="Folder ID imagem referência" />
          <select value={model} onChange={(e) => setModel(e.target.value as 'gpt' | 'nano_banana')}>
            <option value="gpt">gpt</option>
            <option value="nano_banana">nano_banana</option>
          </select>
          <div className="row">
            <button disabled={busy} onClick={() => loadDriveFiles('base')}>Carregar bases</button>
            <button disabled={busy} onClick={() => loadDriveFiles('ref')}>Carregar referência</button>
          </div>
        </div>
      </section>

      <section className="split">
        <div className="card">
          <h3>Imagens base ({baseFiles.length})</h3>
          <div className="list">
            {baseFiles.map((f) => {
              const checked = selectedBaseIds.includes(f.id)
              return (
                <label key={f.id} className="item">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => setSelectedBaseIds((prev) => prev.includes(f.id) ? prev.filter((x) => x !== f.id) : [...prev, f.id])}
                  />
                  <span>{f.name}</span>
                </label>
              )
            })}
          </div>
        </div>

        <div className="card">
          <h3>Imagem referência ({refFiles.length})</h3>
          <select value={referenceImageId} onChange={(e) => setReferenceImageId(e.target.value)}>
            <option value="">Selecione</option>
            {refFiles.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
      </section>

      <button disabled={busy} onClick={createAndStartJob}>Iniciar processamento</button>

      {jobId && (
        <section className="card">
          <h3>Job atual</h3>
          <p>ID: {jobId}</p>
          <p>Status: {jobStatus}</p>
          <p>Progresso: {progress?.approved ?? 0}/{progress?.total ?? 0} ({progress?.progressPct ?? 0}%)</p>
          <button disabled={busy} onClick={() => loadJob()}>Atualizar agora</button>

          <h4>Tela de aprovação</h4>
          {!generatedTask ? (
            <p>Nenhuma imagem aguardando aprovação.</p>
          ) : (
            <>
              <p>Task #{generatedTask.position + 1} • attempts: {generatedTask.attempts}</p>
              <div className="split">
                <div className="card inline"><b>Original</b><p>{generatedTask.base_image_id}</p></div>
                <div className="card inline">
                  <b>Gerada (temp)</b>
                  {generatedTask.output_temp_url?.startsWith('data:image') ? (
                    <img src={generatedTask.output_temp_url} style={{ maxWidth: '100%' }} />
                  ) : (
                    <p>{generatedTask.output_temp_url?.slice(0, 120) || 'Sem output'}</p>
                  )}
                </div>
              </div>
              <div className="row">
                <button disabled={busy} onClick={approveCurrent}>✅ Aprovar</button>
                <button disabled={busy} onClick={rejectCurrent}>❌ Recusar</button>
              </div>
            </>
          )}
        </section>
      )}

      {msg && <p className="msg">{msg}</p>}
    </main>
  )
}

const style = document.createElement('style')
style.innerHTML = `
  :root { color-scheme: dark; }
  body { margin:0; font-family: Inter, system-ui, sans-serif; background: radial-gradient(circle at 10% 10%, #1b2436 0%, #0b1018 45%, #070b12 100%); color:#eaf2ff; }
  .page { max-width: 1100px; margin: 0 auto; padding: 20px; }
  .auth { display:grid; place-items:center; min-height:100vh; }
  .auth-card { max-width:420px; width:100%; text-align:center; }
  .topbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; }
  .card { background: linear-gradient(180deg, rgba(20,28,42,.85), rgba(12,18,30,.85)); border:1px solid rgba(106,255,191,.18); border-radius:14px; padding:14px; margin-bottom:12px; box-shadow: 0 10px 25px rgba(0,0,0,.35); }
  .card.inline { margin-bottom:0; }
  .grid { display:grid; gap:8px; }
  .split { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .row { display:flex; gap:8px; flex-wrap:wrap; }
  .list { max-height:240px; overflow:auto; display:grid; gap:6px; }
  .item { display:flex; gap:8px; align-items:center; }
  input, select, button { border-radius:10px; border:1px solid rgba(106,255,191,.25); background:#0d1522; color:#eaf2ff; padding:10px; }
  button { background: linear-gradient(180deg, #23334d, #18263d); cursor:pointer; }
  button:hover { border-color: rgba(106,255,191,.55); }
  .msg { color:#9fd6ff; }
`
document.head.appendChild(style)

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
