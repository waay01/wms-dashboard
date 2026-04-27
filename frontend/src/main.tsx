import React, { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Uncaught error:', error, info) }
  render() {
    if (this.state.error) return (
      <div style={{padding:40,fontFamily:'monospace',color:'#ef4444',background:'#0f172a',minHeight:'100vh'}}>
        <h1>Произошла ошибка</h1>
        <pre style={{whiteSpace:'pre-wrap',color:'#94a3b8',marginTop:16}}>{this.state.error.message}</pre>
        <button onClick={() => window.location.reload()}
          style={{marginTop:24,padding:'8px 24px',background:'#3b82f6',color:'white',border:'none',borderRadius:8,cursor:'pointer'}}>
          Перезагрузить
        </button>
      </div>
    )
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
