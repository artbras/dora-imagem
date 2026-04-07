import React, { useEffect, useMemo, useRef, useState } from 'react'
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

const clean = (v?: string | null) => String(v || '').trim()
const apiBase = clean((import.meta.env.VITE_API_BASE_URL as string) || '') || 'http://localhost:8787'
const normalizeEmail = (v?: string | null) => clean(v).toLowerCase()
const adminEmail = normalizeEmail((import.meta.env.VITE_ADMIN_EMAIL as string) || 'am.agente.ia@gmail.com')
const baseFolderId = clean((import.meta.env.VITE_GOOGLE_DRIVE_BASE_FOLDER_ID as string) || '')
const refFolderId = clean((import.meta.env.VITE_GOOGLE_DRIVE_REFERENCE_FOLDER_ID as string) || '')
const supabaseUrl = clean((import.meta.env.VITE_SUPABASE_URL as string) || '')
const supabaseAnonKey = clean((import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '')

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
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [route, setRoute] = useState(window.location.pathname === '/config' ? '/config' : '/')
  const [zoomOpen, setZoomOpen] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [autoSequenceMode, setAutoSequenceMode] = useState(false)

  const generatedTask = useMemo(() => tasks.find((t) => t.status === 'generated') || null, [tasks])
  const loadJobInFlight = useRef(false)
  const autoSequenceInFlight = useRef(false)

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

  async function fetchWithAuthRetry(url: string, init?: RequestInit) {
    const doFetch = async () => {
      const headers = {
        ...(init?.headers || {}),
        ...(await authHeaders()),
      } as Record<string, string>
      return fetch(url, { ...init, headers })
    }

    let res = await doFetch()

    if (res.status === 401) {
      const { data } = await supabase.auth.refreshSession()
      if (data?.session) setSession(data.session)
      res = await doFetch()
    }

    return res
  }

  async function apiGet(path: string) {
    const res = await fetchWithAuthRetry(`${apiBase}${path}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || `Erro ${res.status}`)
    return data
  }

  async function apiSend(path: string, method: 'POST' | 'PUT', body?: unknown) {
    const hasBody = body !== undefined
    const res = await fetchWithAuthRetry(`${apiBase}${path}`, {
      method,
      headers: { ...(hasBody ? { 'Content-Type': 'application/json' } : {}) },
      body: hasBody ? JSON.stringify(body) : undefined,
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

  async function loadDriveFiles(type: 'base' | 'ref', silent = false): Promise<number> {
    const folderId = type === 'base' ? baseFolderId : refFolderId
    if (!folderId) {
      if (!silent) setMsg(`Folder ID de ${type === 'base' ? 'base' : 'referência'} não configurado.`)
      return 0
    }
    try {
      const data = await apiGet(`/drive/files?folderId=${encodeURIComponent(folderId)}&email=${encodeURIComponent(adminEmail)}`)
      const files = ((data.files || []) as DriveFile[]).filter((f) => String(f.mimeType || '').startsWith('image/'))
      if (type === 'base') {
        setBaseFiles((prev) => {
          const seen = new Set(prev.map((p) => p.id))
          const onlyNew = files.filter((f) => !seen.has(f.id))
          return onlyNew.length ? [...prev, ...onlyNew] : prev
        })
      } else {
        setRefFiles((prev) => {
          const seen = new Set(prev.map((p) => p.id))
          const onlyNew = files.filter((f) => !seen.has(f.id))
          return onlyNew.length ? [...prev, ...onlyNew] : prev
        })
        if (!referenceImageId && files[0]?.id) setReferenceImageId(files[0].id)
      }
      if (!silent) setMsg(`Sincronização de ${type === 'base' ? 'base' : 'referência'} concluída (${files.length} no Drive).`)
      return files.length
    } catch (e: any) {
      const errorMsg = String(e?.message || e)
      if (errorMsg.toLowerCase().includes('tokens google nao encontrados')) {
        setMsg('Conectando Google Drive automaticamente...')
        connectDriveOAuthAuto()
        return 0
      }
      if (!silent) setMsg(`Falha ao carregar Drive (${type}): ${errorMsg}`)
      return 0
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
    if (loadJobInFlight.current) return
    loadJobInFlight.current = true
    try {
      const data = await apiGet(`/jobs/${targetJobId}`)
      setJobStatus(data.job?.status || '')
      setTasks(data.tasks || [])
      setProgress(data.progress || null)
    } catch (e: any) {
      setMsg(`Erro ao carregar job: ${String(e?.message || e)}`)
    } finally {
      loadJobInFlight.current = false
    }
  }

  async function approveCurrent() {
    if (!generatedTask) return
    setBusy(true)
    setActionLoading('approve')
    try {
      const res = await apiSend(`/tasks/${generatedTask.id}/approve`, 'POST')
      const outputId = String(res?.outputImageId || '')
      const link = outputId ? `https://drive.google.com/file/d/${outputId}/view` : ''
      setMsg(link ? `Imagem aprovada e salva no Drive: ${link}` : 'Imagem aprovada e salva no Drive.')
      await loadJob()
    } finally { setBusy(false); setActionLoading(null) }
  }

  async function rejectCurrent() {
    if (!generatedTask) return
    setBusy(true)
    setActionLoading('reject')
    try {
      await apiSend(`/tasks/${generatedTask.id}/reject`, 'POST')
      setMsg('Imagem recusada. Reprocesso agendado.')
      await loadJob()
    } finally { setBusy(false); setActionLoading(null) }
  }

  function startAutoSequence() {
    if (!jobId) return
    setAutoSequenceMode(true)
    setMsg('Gerando sequência selecionada...')
  }

  function cancelAutoSequence() {
    setAutoSequenceMode(false)
    setActionLoading(null)
    setBusy(false)
    setMsg('Sequência automática cancelada pelo usuário.')
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

  async function syncOperationImages() {
    await loadConfig()
    const connected = await ensureDriveConnected()
    if (!connected) return

    let [baseCount, refCount] = await Promise.all([loadDriveFiles('base', false), loadDriveFiles('ref', false)])
    if (jobId) await loadJob(jobId)

    if (baseCount === 0 || refCount === 0) {
      await new Promise((r) => setTimeout(r, 1200))
      const retry = await Promise.all([loadDriveFiles('base', true), loadDriveFiles('ref', true)])
      baseCount = Math.max(baseCount, retry[0])
      refCount = Math.max(refCount, retry[1])
    }

    if (baseCount === 0 || refCount === 0) {
      setMsg(`Conexão OK, mas sem imagens carregadas (Base: ${baseCount}, Referência: ${refCount}). Clique em Atualizar imagens para revalidar.`)
    }
  }

  useEffect(() => {
    if (!session) return
    void syncOperationImages()
  }, [session])

  useEffect(() => {
    if (!session) return
    if (route === '/config') void loadConfig()
    if (route === '/') void syncOperationImages()
  }, [route, session])

  // Auto-refresh leve enquanto job estiver em processamento para avançar automaticamente para aprovação
  useEffect(() => {
    if (!jobId) return
    if (jobStatus !== 'processing') return
    const t = setInterval(() => void loadJob(jobId), 5000)
    return () => clearInterval(t)
  }, [jobId, jobStatus])

  // Sequência automática: salva a gerada atual e segue até concluir todas
  useEffect(() => {
    if (!autoSequenceMode) return
    if (!jobId) return

    const runTick = async () => {
      if (autoSequenceInFlight.current) return
      autoSequenceInFlight.current = true
      try {
        await loadJob(jobId)

        // se já finalizou, encerra modo automático
        if (jobStatus === 'completed' || ((progress?.approved || 0) >= (progress?.total || 0) && (progress?.total || 0) > 0)) {
          setAutoSequenceMode(false)
          setMsg('Sequência selecionada concluída com sucesso.')
          return
        }

        if (generatedTask) {
          setActionLoading('approve')
          await apiSend(`/tasks/${generatedTask.id}/approve`, 'POST')
          await loadJob(jobId)
          setActionLoading(null)
        }
      } catch (e: any) {
        setAutoSequenceMode(false)
        setActionLoading(null)
        setMsg(`Erro na sequência automática: ${String(e?.message || e)}`)
      } finally {
        autoSequenceInFlight.current = false
      }
    }

    void runTick()
    const t = setInterval(() => void runTick(), 2500)
    return () => clearInterval(t)
  }, [autoSequenceMode, jobId, generatedTask, jobStatus, progress])

  if (!session) {
    return (
      <main className="page auth">
        <section className="card auth-card">
          <img src="/logo-login.png" alt="Dora" className="logo-auth" />
          <p>Liberado somente para —» {adminEmail}</p>
          <button className="google-login-btn" onClick={signInWithGoogle}>
            <img src="/logo-google.jpg" alt="Google" className="google-btn-logo" />
            <span>Entrar com Google</span>
          </button>
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
              <div className="thumb-grid">
                {baseFiles.map((f) => {
                  const checked = selectedBaseIds.includes(f.id)
                  const thumb = `${apiBase}/drive/thumbnail?fileId=${encodeURIComponent(f.id)}&email=${encodeURIComponent(adminEmail)}`
                  return (
                    <label key={f.id} className={`thumb-card ${checked ? 'selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setSelectedBaseIds((prev) => prev.includes(f.id) ? prev.filter((x) => x !== f.id) : [...prev, f.id])}
                      />
                      <img src={thumb} alt={f.name} loading="lazy" />
                      {checked && <b className="thumb-badge">Base selecionada</b>}
                      <span title={f.name}>{f.name}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            <div className="card">
              <div className="card-head-row">
                <h3>Imagem de Referência ({refFiles.length})</h3>
                <div className="llm-switch compact" role="radiogroup" aria-label="Modelo da geração">
                  <button
                    type="button"
                    className={`llm-btn ${model === 'gpt' ? 'active' : ''}`}
                    onClick={() => setModel('gpt')}
                    aria-pressed={model === 'gpt'}
                    title="GPT"
                  >
                    <img src="/logo-gpt.jpg" alt="GPT" className="llm-logo-img" />
                  </button>
                  <button
                    type="button"
                    className={`llm-btn ${model === 'nano_banana' ? 'active' : ''}`}
                    onClick={() => setModel('nano_banana')}
                    aria-pressed={model === 'nano_banana'}
                    title="Nano Banana (Google)"
                  >
                    <img src="/logo-google.jpg" alt="Google" className="llm-logo-img" />
                  </button>
                </div>
              </div>
              <div className="thumb-grid single">
                {refFiles.map((f) => {
                  const checked = referenceImageId === f.id
                  const thumb = `${apiBase}/drive/thumbnail?fileId=${encodeURIComponent(f.id)}&email=${encodeURIComponent(adminEmail)}`
                  return (
                    <label key={f.id} className={`thumb-card ${checked ? 'selected' : ''}`}>
                      <input
                        type="radio"
                        name="reference-image"
                        checked={checked}
                        onChange={() => setReferenceImageId(f.id)}
                      />
                      <img src={thumb} alt={f.name} loading="lazy" />
                      {checked && <b className="thumb-badge">Referência ativa</b>}
                      <span title={f.name}>{f.name}</span>
                    </label>
                  )
                })}
              </div>

            </div>
          </section>

          <div className="row" style={{ marginTop: 8 }}>
            <button disabled={busy} onClick={async () => { setBusy(true); setActionLoading('sync'); await Promise.all([loadDriveFiles('base', false), loadDriveFiles('ref', false)]); setBusy(false); setActionLoading(null) }}>
              {actionLoading === 'sync' ? 'Sincronizando...' : 'Atualizar imagens'}
            </button>
            <button disabled={busy} onClick={createAndStartJob}>Iniciar processamento</button>
          </div>

          {jobId && (
            <section className="card">
              <h3>Job atual</h3>
              <p>Status: {jobStatus}</p>
              <p>Progresso: {progress?.approved ?? 0}/{progress?.total ?? 0} ({progress?.progressPct ?? 0}%)</p>
              <div className="progress-wrap" aria-label="Progresso da geração">
                <div className="progress-bar" style={{ width: `${progress?.progressPct ?? 0}%` }} />
              </div>
              {jobStatus === 'processing' && !generatedTask && (
                <p className="processing-hint">⏳ Processando imagem... consultando periodicamente a resposta da LLM.</p>
              )}

              <h4>Tela de aprovação</h4>
              {!generatedTask ? (
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <p>Nenhuma imagem aguardando aprovação.</p>
                  {jobStatus === 'completed' && (
                    <button type="button" onClick={() => window.location.reload()}>LIMPAR</button>
                  )}
                </div>
              ) : (
                <>
                  <p>Task #{generatedTask.position + 1} • attempts: {generatedTask.attempts}</p>
                  <div className="split">
                    <div className="card inline">
                      <b>Original</b>
                      <img
                        src={`${apiBase}/drive/thumbnail?fileId=${encodeURIComponent(generatedTask.base_image_id)}&email=${encodeURIComponent(adminEmail)}`}
                        alt="Original"
                        className="approval-img"
                      />
                    </div>
                    <div className="card inline">
                      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <b>Gerada</b>
                        {generatedTask.output_temp_url?.startsWith('data:image') && (
                          <button type="button" onClick={() => { setZoomLevel(1); setZoomOpen(true) }} title="Ampliar">🔎 Ampliar</button>
                        )}
                      </div>
                      {generatedTask.output_temp_url?.startsWith('data:image') ? (
                        <img src={generatedTask.output_temp_url} alt="Gerada" className="approval-img" />
                      ) : (
                        <p>{generatedTask.output_temp_url?.slice(0, 120) || 'Sem output'}</p>
                      )}
                    </div>
                  </div>
                  <div className="row">
                    {!autoSequenceMode ? (
                      <>
                        <button disabled={busy} onClick={approveCurrent}>{actionLoading === 'approve' ? 'Aprovando...' : '✅ Salvar'}</button>
                        <button disabled={busy} onClick={rejectCurrent}>{actionLoading === 'reject' ? 'Recusando...' : '❌ Recusar'}</button>
                        <button type="button" disabled={busy} onClick={startAutoSequence}>⚙️ Gerar Sequência Selecionada</button>
                        <button type="button" disabled={busy} onClick={() => window.location.reload()}>Cancelar</button>
                      </>
                    ) : (
                      <button type="button" onClick={cancelAutoSequence}>Cancelar</button>
                    )}
                  </div>
                </>
              )}
            </section>
          )}
        </>
      )}

      {autoSequenceMode && (
        <div className="sequence-overlay">
          <div className="sequence-modal">
            <div className="gear">⚙️</div>
            <h3>Gerando sequência selecionada</h3>
            <p>Aguarde enquanto salvamos e processamos as imagens automaticamente.</p>
            <div className="progress-wrap" aria-label="Progresso da sequência">
              <div className="progress-bar" style={{ width: `${progress?.progressPct ?? 0}%` }} />
            </div>
            <p>{progress?.approved ?? 0}/{progress?.total ?? 0} concluídas</p>
            <p>Imagem atual: {Math.min((progress?.approved ?? 0) + 1, progress?.total ?? 0)} de {progress?.total ?? 0}</p>
            <button type="button" onClick={cancelAutoSequence}>Cancelar</button>
          </div>
        </div>
      )}

      {zoomOpen && generatedTask?.output_temp_url?.startsWith('data:image') && (
        <div className="zoom-overlay" onClick={() => setZoomOpen(false)}>
          <div className="zoom-box" onClick={(e) => e.stopPropagation()}>
            <div className="zoom-toolbar">
              <button type="button" onClick={() => setZoomLevel((z) => Math.max(1, Number((z - 0.25).toFixed(2))))}>−</button>
              <span>{Math.round(zoomLevel * 100)}%</span>
              <button type="button" onClick={() => setZoomLevel((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}>+</button>
              <button className="zoom-close" onClick={() => setZoomOpen(false)}>✕</button>
            </div>
            <img src={generatedTask.output_temp_url} alt="Gerada ampliada" className="zoom-img" style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'center center' }} />
          </div>
        </div>
      )}

      {msg && <p className="msg">{msg}</p>}
    </main>
  )
}

const style = document.createElement('style')
style.innerHTML = `
  :root { color-scheme: dark; }
  body { margin:0; font-family: Inter, system-ui, sans-serif; background: linear-gradient(rgba(8,10,16,.86), rgba(8,10,16,.86)), url('/bg-adoro-mimo.jpg') center/cover fixed no-repeat; color:#eaf2ff; }
  .page { max-width: 1100px; margin: 0 auto; padding: 20px; }
  .auth { display:grid; place-items:center; min-height:100vh; }
  .auth-card { max-width:420px; width:100%; text-align:center; }
  .logo-auth { max-width: 280px; margin-bottom: 10px; }
  .google-login-btn { display:inline-flex; align-items:center; gap:8px; }
  .google-btn-logo { width:18px; height:18px; object-fit:contain; border-radius:3px; }
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
  .thumb-grid { display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap:10px; max-height: 420px; overflow:auto; }
  .thumb-grid.single { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .thumb-card { display:flex; flex-direction:column; gap:6px; border:1px solid rgba(106,255,191,.25); border-radius:12px; padding:8px; background:#0d1522; cursor:pointer; }
  .thumb-card.selected { border-color: rgba(106,255,191,.9); box-shadow: 0 0 0 1px rgba(106,255,191,.4) inset; }
  .thumb-card input { align-self:flex-start; }
  .thumb-card img { width:100%; height:120px; object-fit:cover; border-radius:8px; background:#0a1018; }
  .approval-img { width:100%; max-height:260px; object-fit:contain; border-radius:10px; margin-top:8px; background:#0a1018; }
  .thumb-badge { display:inline-block; font-size:10px; background:#113d2d; color:#9cffd5; border:1px solid #1d6d4f; border-radius:999px; padding:2px 8px; width:max-content; }
  .thumb-card span { font-size:12px; opacity:.9; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .progress-wrap { width:100%; height:10px; border-radius:999px; background:#0a1018; border:1px solid rgba(106,255,191,.25); overflow:hidden; margin:8px 0; }
  .progress-bar { height:100%; background: linear-gradient(90deg, #2cae84, #69ffc0); transition: width .5s ease; }
  .processing-hint { font-size:12px; color:#9fd6ff; animation: pulse 1.4s ease-in-out infinite; }
  .sequence-overlay { position:fixed; inset:0; background:rgba(4,8,14,.86); display:grid; place-items:center; z-index:10000; }
  .sequence-modal { width:min(92vw, 520px); background:#0b1220; border:1px solid rgba(106,255,191,.35); border-radius:14px; padding:18px; text-align:center; box-shadow:0 20px 60px rgba(0,0,0,.5); }
  .gear { font-size:44px; display:inline-block; animation: spin 1.6s linear infinite; }
  .zoom-overlay { position:fixed; inset:0; background:rgba(0,0,0,.75); display:grid; place-items:center; z-index:9999; }
  .zoom-box { position:relative; width:min(92vw, 1100px); height:min(88vh, 900px); background:#0b1220; border:1px solid rgba(106,255,191,.25); border-radius:12px; padding:12px; overflow:auto; }
  .zoom-toolbar { position:sticky; top:0; z-index:3; display:flex; gap:8px; align-items:center; justify-content:flex-end; margin-bottom:8px; background:rgba(11,18,32,.8); backdrop-filter: blur(4px); padding:6px; border-radius:10px; }
  .zoom-img { width:100%; height:calc(100% - 52px); object-fit:contain; }
  .zoom-close { z-index:2; }
  @keyframes pulse { 0%,100%{opacity:.5} 50%{opacity:1} }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  input, select, textarea, button { border-radius:10px; border:1px solid rgba(106,255,191,.25); background:#0d1522; color:#eaf2ff; padding:10px; }
  button { background: linear-gradient(180deg, #23334d, #18263d); cursor:pointer; }
  button:hover { border-color: rgba(106,255,191,.55); }
  .card-head-row { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px; }
  .llm-switch { display:grid; grid-template-columns: 1fr 1fr; gap:8px; }
  .llm-switch.compact { display:flex; gap:6px; }
  .llm-btn { display:flex; align-items:center; justify-content:center; gap:6px; padding:6px 8px; min-width:40px; border-radius:999px; }
  .llm-btn.active { border-color: rgba(106,255,191,.9); box-shadow: 0 0 0 1px rgba(106,255,191,.45) inset; }
  .llm-logo-img { width:18px; height:18px; border-radius:4px; object-fit:contain; background:transparent; }
  .msg { color:#9fd6ff; }
`
document.head.appendChild(style)

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
