import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'

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

type JobPayload = {
  job: { id: string; status: string; model: string; total: number }
}

const apiBase = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:8787'
const defaultEmail = (import.meta.env.VITE_ADMIN_EMAIL as string) || 'am.agente.ia@gmail.com'
const defaultBaseFolder = (import.meta.env.VITE_GOOGLE_DRIVE_BASE_FOLDER_ID as string) || ''
const defaultRefFolder = (import.meta.env.VITE_GOOGLE_DRIVE_REFERENCE_FOLDER_ID as string) || ''

function App() {
  const [email, setEmail] = useState(defaultEmail)
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

  const generatedTask = useMemo(
    () => tasks.find((t) => t.status === 'generated') || null,
    [tasks],
  )

  async function apiGet(path: string) {
    const res = await fetch(`${apiBase}${path}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || `Erro ${res.status}`)
    return data
  }

  async function apiPost(path: string, body?: unknown) {
    const res = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || `Erro ${res.status}`)
    return data
  }

  async function loadDriveFiles(type: 'base' | 'ref') {
    const folderId = type === 'base' ? baseFolderId : refFolderId
    if (!folderId) return
    setBusy(true)
    try {
      const data = await apiGet(`/drive/files?folderId=${encodeURIComponent(folderId)}&email=${encodeURIComponent(email)}`)
      const files = (data.files || []) as DriveFile[]
      if (type === 'base') setBaseFiles(files)
      else setRefFiles(files)
      setMsg(`Arquivos ${type === 'base' ? 'base' : 'referência'} carregados: ${files.length}`)
    } catch (e: any) {
      setMsg(`Falha ao carregar Drive (${type}): ${String(e?.message || e)}`)
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
      const created = (await apiPost('/jobs', {
        email,
        baseImageIds: selectedBaseIds,
        referenceImageId,
        model,
      })) as JobPayload

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
    if (!jobId) return
    const t = setInterval(() => void loadJob(jobId), 4000)
    return () => clearInterval(t)
  }, [jobId])

  return (
    <main style={{ fontFamily: 'Inter, sans-serif', padding: 20, maxWidth: 1100, margin: '0 auto' }}>
      <h1>Dora-imagem — Operação MVP</h1>
      <p style={{ marginTop: -8, opacity: 0.75 }}>Seleção de imagens, início de job e aprovação/rejeição.</p>

      <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8, marginBottom: 12 }}>
        <h3>Configuração</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email operador" />
          <input value={baseFolderId} onChange={(e) => setBaseFolderId(e.target.value)} placeholder="Folder ID imagens base" />
          <input value={refFolderId} onChange={(e) => setRefFolderId(e.target.value)} placeholder="Folder ID imagem referência" />
          <select value={model} onChange={(e) => setModel(e.target.value as 'gpt' | 'nano_banana')}>
            <option value="gpt">gpt</option>
            <option value="nano_banana">nano_banana</option>
          </select>
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={busy} onClick={() => loadDriveFiles('base')}>Carregar bases</button>
            <button disabled={busy} onClick={() => loadDriveFiles('ref')}>Carregar referência</button>
          </div>
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8 }}>
          <h3>Imagens base ({baseFiles.length})</h3>
          <div style={{ maxHeight: 240, overflow: 'auto', display: 'grid', gap: 6 }}>
            {baseFiles.map((f) => {
              const checked = selectedBaseIds.includes(f.id)
              return (
                <label key={f.id} style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setSelectedBaseIds((prev) =>
                        prev.includes(f.id) ? prev.filter((x) => x !== f.id) : [...prev, f.id],
                      )
                    }
                  />
                  <span>{f.name}</span>
                </label>
              )
            })}
          </div>
        </div>

        <div style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8 }}>
          <h3>Imagem referência ({refFiles.length})</h3>
          <select
            value={referenceImageId}
            onChange={(e) => setReferenceImageId(e.target.value)}
            style={{ width: '100%' }}
          >
            <option value="">Selecione</option>
            {refFiles.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      <button disabled={busy} onClick={createAndStartJob}>Iniciar processamento</button>

      {jobId && (
        <section style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8, marginTop: 12 }}>
          <h3>Job atual</h3>
          <p>ID: {jobId}</p>
          <p>Status: {jobStatus}</p>
          <p>
            Progresso: {progress?.approved ?? 0}/{progress?.total ?? 0} ({progress?.progressPct ?? 0}%)
          </p>
          <button disabled={busy} onClick={() => loadJob()}>Atualizar agora</button>

          <hr />

          <h4>Tela de aprovação</h4>
          {!generatedTask ? (
            <p>Nenhuma imagem aguardando aprovação no momento.</p>
          ) : (
            <div>
              <p>
                Task #{generatedTask.position + 1} • attempts: {generatedTask.attempts}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{ border: '1px dashed #ccc', padding: 8 }}>
                  <b>Original</b>
                  <p style={{ wordBreak: 'break-all' }}>{generatedTask.base_image_id}</p>
                </div>
                <div style={{ border: '1px dashed #ccc', padding: 8 }}>
                  <b>Gerada (temp)</b>
                  {generatedTask.output_temp_url ? (
                    generatedTask.output_temp_url.startsWith('data:image') ? (
                      <img src={generatedTask.output_temp_url} style={{ maxWidth: '100%' }} />
                    ) : (
                      <p style={{ wordBreak: 'break-all' }}>{generatedTask.output_temp_url.slice(0, 120)}...</p>
                    )
                  ) : (
                    <p>Sem output_temp_url</p>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button disabled={busy} onClick={approveCurrent}>✅ Aprovar</button>
                <button disabled={busy} onClick={rejectCurrent}>❌ Recusar</button>
              </div>
            </div>
          )}
        </section>
      )}

      {msg && <p style={{ marginTop: 12 }}>{msg}</p>}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
