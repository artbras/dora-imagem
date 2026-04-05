import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createClient, type Session } from '@supabase/supabase-js'

type DriveFile = { id: string; name: string; mimeType?: string }
type JobTask = {
  id: string
  base_image_id: string
  output_temp_url?: string | null
  status: 'pending' | 'generated' | 'approved' | 'rejected'
  attempts: number
  position: number
}

const apiBase = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:8787'
const normalizeEmail = (v?: string | null) => String(v || '').trim().toLowerCase()
const adminEmail = normalizeEmail((import.meta.env.VITE_ADMIN_EMAIL as string) || 'am.agente.ia@gmail.com')
const baseFolderId = (import.meta.env.VITE_GOOGLE_DRIVE_BASE_FOLDER_ID as string) || ''
const refFolderId = (import.meta.env.VITE_GOOGLE_DRIVE_REFERENCE_FOLDER_ID as string) || ''
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) || ''
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || ''

const supabase = createClient(supabaseUrl, supabaseAnonKey)

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [model, setModel] = useState<'gpt' | 'nano_banana'>('gpt')

  const [baseFiles, setBaseFiles] = useState<DriveFile[]>([])
  const [refFiles, setRefFiles] = useState<DriveFile[]>([])
  const [selectedBaseIds, setSelectedBaseIds] = useState<string[]>([])
  const [referenceImageId, setReferenceImageId] = useState('')

  const [jobId, setJobId] = useState('')
  const [jobStatus, setJobStatus] = useState('')
  const [tasks, setTasks] = useState<JobTask[]>([])
  const [progress, setProgress] = useState<{ total: number; approved: number; progressPct: number } | null>(null)

  const [configLlm, setConfigLlm] = useState<'gpt' | 'nano_banana'>('gpt')
  const [promptPositive, setPromptPositive] = useState('')
  const [promptNegative, setPromptNegative] = useState('')

  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [route, setRoute] = useState(window.location.pathname === '/config' ? '/config' : '/')

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

    const onPop = () => setRoute(window.location.pathname === '/config' ? '/config' : '/')
    window.addEventListener('popstate', onPop)
    return () => {
      sub.subscription.unsubscribe()
      window.removeEventListener('popstate', onPop)
    }
  }, [])

  function navigate(path: '/' | '/config') {
    window.history.pushState({}, '', path)
    setRoute(path)
  }

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

  async function apiSend(path: string, method: 'POST' | 'PUT', body?: unknown) {
    const res = await fetch(`${apiBase}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || `Erro ${res.status}`)
    return data
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
    if (error) setMsg(`Erro login Google: ${error.message}`)
  }

  function connectDriveOAuthAuto() {
    const returnTo = encodeURIComponent(window.location.href)
    window.location.href = `${apiBase}/auth/google?email=${encodeURIComponent(adminEmail)}&returnTo=${returnTo}`
  }

  async function loadDriveFiles(type: 'base' | 'ref', silent = false) {
    const folderId = type === 'base' ? baseFolderId : refFolderId
    if (!folderId) return
    try {
      const data = await apiGet(`/drive/files?folderId=${encodeURIComponent(folderId)}&email=${encodeURIComponent(adminEmail)}`)
      const files = (data.files || []) as DriveFile[]
      if (type === 'base') setBaseFiles(files)
      else {
        setRefFiles(files)
        if (!referenceImageId && files[0]?.id) setReferenceImageId(files[0].id)
      }
      if (!silent) setMsg(`Arquivos ${type === 'base' ? 'base' : 'referência'} carregados: ${files.length}`)
    } catch (e: any) {
      const errorMsg = String(e?.message || e)
      if (errorMsg.toLowerCase().includes('tokens google nao encontrados')) {
        setMsg('Conectando Google Drive automaticamente...')
        connectDriveOAuthAuto()
        return
      }
      if (!silent) setMsg(`Falha ao carregar Drive (${type}): ${errorMsg}`)
    }
  }

  async function loadConfig() {
    try {
      const data = await apiGet('/config')
      const cfg = data?.config || {}
      const llm = String(cfg.default_model || 'gpt') === 'nano_banana' ? 'nano_banana' : 'gpt'
      setConfigLlm(llm)
      setPromptPositive(String(cfg.prompt_positive || ''))
      setPromptNegative(String(cfg.prompt_negative || ''))
    } catch (e: any) {
      setMsg(`Erro ao carregar config: ${String(e?.message || e)}`)
    }
  }

  async function saveConfig() {
    setBusy(true)
    try {
      await apiSend('/config', 'PUT', { llm: configLlm, promptPositive, promptNegative })
      setMsg('Configuração salva com sucesso.')
    } catch (e: any) {
      setMsg(`Erro ao salvar config: ${String(e?.message || e)}`)
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
      const created = await apiSend('/jobs', 'POST', {
        email: adminEmail,
        baseImageIds: selectedBaseIds,
        referenceImageId,
        model,
      })
      setJobId(created.job.id)
      await apiSend(`/jobs/${created.job.id}/start`, 'POST')
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
      await apiSend(`/tasks/${generatedTask.id}/approve`, 'POST', { outputTempUrl: generatedTask.output_temp_url })
      setMsg('Imagem aprovada. Processando próxima...')
      await loadJob()
    } finally { setBusy(false) }
  }

  async function rejectCurrent() {
    if (!generatedTask) return
    setBusy(true)
    try {
      await apiSend(`/tasks/${generatedTask.id}/reject`, 'POST')
      setMsg('Imagem recusada. Reprocessando...')
      await loadJob()
    } finally { setBusy(false) }
  }

  async function ensureDriveConnected() {
    try {
      const status = await apiGet(`/auth/drive-status?email=${encodeURIComponent(adminEmail)}`)
      if (!status?.connected) {
        setMsg('Conectando Google Drive automaticamente...')
        connectDriveOAuthAuto()
        return false
      }
      return true
    } catch {
      setMsg('Conectando Google Drive automaticamente...')
      connectDriveOAuthAuto()
      return false
    }
  }

  useEffect(() => {
    if (!session) return
    ;(async () => {
      const connected = await ensureDriveConnected()
      if (!connected) return
      await Promise.all([loadDriveFiles('base', true), loadDriveFiles('ref', true)])
      await loadConfig()
      setMsg('Imagens das pastas Base e Referência carregadas automaticamente.')
    })()
  }, [session])

  useEffect(() => {
    if (!jobId) return
    const t = setInterval(() => void loadJob(jobId), 4000)
    return () => clearInterval(t)
  }, [jobId])

  if (!session) {
    return (
      <main className="page auth">
        <section className="card auth-card">
          <img src="/logo-login.png" alt="Dora" className="logo-auth" />
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
        <div className="brand">
          <img src="/logo-login.png" alt="Dora" className="logo-head" />
          <nav className="menu">
            <button className={route === '/' ? 'active' : ''} onClick={() => navigate('/')}>Operação</button>
            <button className={route === '/config' ? 'active' : ''} onClick={() => navigate('/config')}>Config</button>
          </nav>
        </div>
        <div className="row">
          <button onClick={() => supabase.auth.signOut()}>Sair</button>
        </div>
      </header>

      {route === '/config' ? (
        <section className="card">
          <h3>Configuração</h3>
          <div className="grid">
            <label>LLM</label>
            <select value={configLlm} onChange={(e) => setConfigLlm(e.target.value as 'gpt' | 'nano_banana')}>
              <option value="gpt">gpt</option>
              <option value="nano_banana">nano_banana</option>
            </select>
            <label>Prompt Positivo</label>
            <textarea rows={5} value={promptPositive} onChange={(e) => setPromptPositive(e.target.value)} />
            <label>Prompt Negativo</label>
            <textarea rows={5} value={promptNegative} onChange={(e) => setPromptNegative(e.target.value)} />
            <button disabled={busy} onClick={saveConfig}>Salvar Configuração</button>
          </div>
        </section>
      ) : (
        <>
          <section className="split">
            <div className="card">
              <h3>Imagens Base ({baseFiles.length})</h3>
              <div className="list">
                {baseFiles.map((f) => {
                  const checked = selectedBaseIds.includes(f.id)
                  return (
                    <label key={f.id} className="item">
                      <input type="checkbox" checked={checked} onChange={() => setSelectedBaseIds((prev) => prev.includes(f.id) ? prev.filter((x) => x !== f.id) : [...prev, f.id])} />
                      <span>{f.name}</span>
                    </label>
                  )
                })}
              </div>
            </div>
            <div className="card">
              <h3>Imagem de Referência ({refFiles.length})</h3>
              <select value={referenceImageId} onChange={(e) => setReferenceImageId(e.target.value)}>
                <option value="">Selecione</option>
                {refFiles.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <label style={{ marginTop: 8 }}>Modelo da geração</label>
              <select value={model} onChange={(e) => setModel(e.target.value as 'gpt' | 'nano_banana')}>
                <option value="gpt">gpt</option>
                <option value="nano_banana">nano_banana</option>
              </select>
            </div>
          </section>

          <button disabled={busy} onClick={createAndStartJob}>Iniciar processamento</button>

          {jobId && (
            <section className="card">
              <h3>Job atual</h3>
              <p>Status: {jobStatus}</p>
              <p>Progresso: {progress?.approved ?? 0}/{progress?.total ?? 0} ({progress?.progressPct ?? 0}%)</p>

              <h4>Tela de aprovação</h4>
              {!generatedTask ? <p>Nenhuma imagem aguardando aprovação.</p> : (
                <>
                  <p>Task #{generatedTask.position + 1} • attempts: {generatedTask.attempts}</p>
                  <div className="split">
                    <div className="card inline"><b>Original</b><p>{generatedTask.base_image_id}</p></div>
                    <div className="card inline"><b>Gerada (temp)</b><p>{generatedTask.output_temp_url?.slice(0, 120) || 'Sem output'}</p></div>
                  </div>
                  <div className="row">
                    <button disabled={busy} onClick={approveCurrent}>✅ Aprovar</button>
                    <button disabled={busy} onClick={rejectCurrent}>❌ Recusar</button>
                  </div>
                </>
              )}
            </section>
          )}
        </>
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
  .logo-auth { max-width: 280px; margin-bottom: 10px; }
  .topbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; }
  .brand { display:flex; align-items:center; gap:16px; }
  .logo-head { height:40px; width:auto; }
  .menu { display:flex; gap:8px; }
  .menu button.active { border-color: rgba(106,255,191,.8); }
  .card { background: linear-gradient(180deg, rgba(20,28,42,.85), rgba(12,18,30,.85)); border:1px solid rgba(106,255,191,.18); border-radius:14px; padding:14px; margin-bottom:12px; box-shadow: 0 10px 25px rgba(0,0,0,.35); }
  .card.inline { margin-bottom:0; }
  .grid { display:grid; gap:8px; }
  .split { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .row { display:flex; gap:8px; flex-wrap:wrap; }
  .list { max-height:240px; overflow:auto; display:grid; gap:6px; }
  .item { display:flex; gap:8px; align-items:center; }
  input, select, textarea, button { border-radius:10px; border:1px solid rgba(106,255,191,.25); background:#0d1522; color:#eaf2ff; padding:10px; }
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
