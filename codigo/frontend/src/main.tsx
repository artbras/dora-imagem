import React from 'react'
import { createRoot } from 'react-dom/client'

function App() {
  return (
    <main style={{ fontFamily: 'Inter, sans-serif', padding: 24 }}>
      <h1>Dora-imagem</h1>
      <p>MVP em preparação. Frontend conectado ao plano técnico.</p>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
