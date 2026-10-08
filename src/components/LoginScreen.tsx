import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ensureIncomingWebhook, getQr, getStateInstance, sendAuthorizationPassword } from '../api/greenApi.ts'
import type { Credentials } from '../types.ts'
import {
  DEFAULT_CREDENTIALS,
  describeInstanceState,
  humanizeApiError,
  isAbortError,
  normalizeCredentials,
  sleep,
  toQrSrc,
  validateCredentials,
} from '../utils.ts'

type Step = 'credentials' | 'qr' | 'password' | 'starting'

interface LoginScreenProps {
  onSuccess: (credentials: Credentials, notice: string) => void
}

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const [form, setForm] = useState(DEFAULT_CREDENTIALS)
  const [showToken, setShowToken] = useState(false)
  const [step, setStep] = useState<Step>('credentials')
  const [pending, setPending] = useState<Credentials | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [hint, setHint] = useState('')
  const [qrSrc, setQrSrc] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [passwordBusy, setPasswordBusy] = useState(false)
  const finished = useRef(false)
  const noticeRef = useRef('')
  const onSuccessRef = useRef(onSuccess)

  useEffect(() => {
    onSuccessRef.current = onSuccess
  }, [onSuccess])

  function finish(credentials: Credentials) {
    if (finished.current) return
    finished.current = true
    onSuccessRef.current(credentials, noticeRef.current)
  }

  useEffect(() => {
    if (!pending || step === 'credentials') return
    const credentials = pending
    const controller = new AbortController()
    let stopped = false

    async function pollState() {
      while (!stopped) {
        try {
          const state = await getStateInstance(credentials, controller.signal)
          if (stopped) return
          if (state === 'authorized') {
            finish(credentials)
            return
          }
          if (state === 'pendingPassword') setStep('password')
          else if (state === 'notAuthorized') setStep('qr')
          else if (state === 'starting') setStep('starting')
          else {
            setError(describeInstanceState(state))
            setStep('credentials')
            return
          }
        } catch (pollError) {
          if (stopped || isAbortError(pollError)) return
          setHint(humanizeApiError(pollError))
        }
        try {
          await sleep(3000, controller.signal)
        } catch {
          return
        }
      }
    }

    void pollState()
    return () => {
      stopped = true
      controller.abort()
    }
  }, [pending, step])

  useEffect(() => {
    if (step !== 'qr' || !pending) return
    const credentials = pending
    const controller = new AbortController()
    let stopped = false

    async function loadQr() {
      while (!stopped) {
        try {
          const qr = await getQr(credentials, controller.signal)
          if (stopped) return
          if (qr.message && (qr.type === 'qrCode' || !qr.type)) {
            setHint('')
            setQrSrc(toQrSrc(qr.message))
          } else if (qr.type === 'already_registered' || qr.type === 'alreadyLogged') {
            finish(credentials)
            return
          } else if (qr.type === 'error') {
            setHint(humanizeApiError(qr.message || 'Не удалось получить QR-код'))
          }
        } catch (qrError) {
          if (stopped || isAbortError(qrError)) return
          setHint(humanizeApiError(qrError))
        }
        try {
          await sleep(5000, controller.signal)
        } catch {
          return
        }
      }
    }

    void loadQr()
    return () => {
      stopped = true
      controller.abort()
    }
  }, [pending, step])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setHint('')
    const credentials = normalizeCredentials(form)
    const validation = validateCredentials(credentials)
    if (validation) {
      setError(validation)
      return
    }

    setSubmitting(true)
    finished.current = false
    try {
      const updated = await ensureIncomingWebhook(credentials)
      const nextNotice = updated
        ? 'Получение сообщений включено. Инстанс может перезапускаться несколько минут.'
        : ''
      noticeRef.current = nextNotice
      setNotice(nextNotice)
      setPending(credentials)
      const state = await getStateInstance(credentials)
      if (state === 'authorized') {
        finish(credentials)
        return
      }
      if (state === 'pendingPassword') setStep('password')
      else if (state === 'starting') setStep('starting')
      else if (state === 'notAuthorized') setStep('qr')
      else setError(describeInstanceState(state))
    } catch (submitError) {
      setError(humanizeApiError(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  async function handlePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!pending || !password.trim()) return
    setPasswordBusy(true)
    setError('')
    try {
      await sendAuthorizationPassword(pending, password.trim())
      const state = await getStateInstance(pending)
      if (state === 'authorized') finish(pending)
      else if (state === 'pendingPassword') setError('Неверный облачный пароль Telegram.')
      else if (state === 'notAuthorized') setStep('qr')
      else if (state === 'starting') setStep('starting')
      else setError(describeInstanceState(state))
    } catch (passwordError) {
      setError(humanizeApiError(passwordError))
    } finally {
      setPasswordBusy(false)
    }
  }

  function backToForm() {
    finished.current = false
    setStep('credentials')
    setPending(null)
    setQrSrc('')
    setPassword('')
    setHint('')
  }

  return (
    <main className="login">
      <section className="login__card">
        <div className="login__logo" aria-hidden="true">
          <PlaneIcon />
        </div>
        <h1>Telegram</h1>
        <p className="login__lead">Текстовые сообщения через GREEN-API</p>

        {step === 'credentials' && (
          <form className="login__form" onSubmit={(event) => void handleSubmit(event)}>
            <label>
              idInstance
              <input
                value={form.idInstance}
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setForm((current) => ({ ...current, idInstance: event.target.value }))}
              />
            </label>
            <label>
              apiTokenInstance
              <span className="login__token">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={form.apiTokenInstance}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setForm((current) => ({ ...current, apiTokenInstance: event.target.value }))}
                />
                <button type="button" className="login__ghost" onClick={() => setShowToken((current) => !current)}>
                  {showToken ? 'Скрыть' : 'Показать'}
                </button>
              </span>
            </label>
            <label>
              apiUrl
              <input
                value={form.apiUrl}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setForm((current) => ({ ...current, apiUrl: event.target.value }))}
              />
            </label>
            <p className="login__note">
              Если входящие уведомления выключены, при входе они будут включены. Инстанс может ненадолго перезапуститься.
            </p>
            {error && <p className="login__error">{error}</p>}
            <button className="login__primary" type="submit" disabled={submitting}>
              {submitting ? 'Подключение…' : 'Войти'}
            </button>
          </form>
        )}

        {step === 'qr' && (
          <div className="login__status">
            <p>Откройте Telegram на телефоне: Настройки → Устройства → Подключить устройство.</p>
            <div className="login__qr">
              {qrSrc ? <img src={qrSrc} alt="QR-код для подключения Telegram" /> : <div className="spinner" />}
            </div>
            {notice && <p className="login__note">{notice}</p>}
            {hint && <p className="login__hint">{hint}</p>}
            {error && <p className="login__error">{error}</p>}
            <button type="button" className="login__primary" onClick={backToForm}>
              Изменить данные
            </button>
          </div>
        )}

        {step === 'starting' && (
          <div className="login__status">
            <div className="spinner" />
            <p>Инстанс запускается. Обычно это занимает не больше нескольких минут.</p>
            {notice && <p className="login__note">{notice}</p>}
            {hint && <p className="login__hint">{hint}</p>}
            <button type="button" className="login__primary" onClick={backToForm}>
              Назад
            </button>
          </div>
        )}

        {step === 'password' && (
          <form className="login__form" onSubmit={(event) => void handlePassword(event)}>
            <p>На аккаунте включён облачный пароль Telegram. Введите его, чтобы закончить подключение.</p>
            <label>
              Облачный пароль
              <input
                type="password"
                value={password}
                autoComplete="off"
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error && <p className="login__error">{error}</p>}
            <button className="login__primary" type="submit" disabled={passwordBusy || !password.trim()}>
              {passwordBusy ? 'Проверка…' : 'Подтвердить'}
            </button>
            <button type="button" className="login__ghost" onClick={backToForm}>
              Назад
            </button>
          </form>
        )}
      </section>
    </main>
  )
}

function PlaneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3.4 10.2 15.6 12 3.4 13.8z" />
    </svg>
  )
}
