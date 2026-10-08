import { useState } from 'react'
import { LoginScreen } from './components/LoginScreen.tsx'
import { Messenger } from './components/Messenger.tsx'
import { clearCredentials, loadCredentials, saveCredentials } from './storage.ts'
import type { Credentials } from './types.ts'

export default function App() {
  const [credentials, setCredentials] = useState<Credentials | null>(() => loadCredentials())
  const [notice, setNotice] = useState('')

  function handleLogin(next: Credentials, nextNotice: string) {
    saveCredentials(next)
    setNotice(nextNotice)
    setCredentials(next)
  }

  function handleLogout() {
    clearCredentials()
    setNotice('')
    setCredentials(null)
  }

  if (!credentials) return <LoginScreen onSuccess={handleLogin} />
  return <Messenger credentials={credentials} notice={notice} onLogout={handleLogout} />
}
