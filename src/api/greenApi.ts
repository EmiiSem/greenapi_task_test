import { isWebhookPrepared, markWebhookPrepared } from '../storage.ts'
import type { Credentials, IncomingNotification } from '../types.ts'
import { humanizeApiError, isAbortError } from '../utils.ts'

interface SettingsResponse {
  webhookUrl?: string
  incomingWebhook?: string
  saveSettings?: boolean
}

interface CheckAccountResponse {
  exist?: boolean
  chatId?: string
  username?: string
  phoneNumber?: number
  status?: boolean
  reason?: string
  data?: { reason?: string }
}

interface QrResponse {
  type?: string
  message?: string
}

interface PasswordResponse {
  status?: boolean
  data?: { status?: string; reason?: string }
}

export async function getStateInstance(credentials: Credentials, signal?: AbortSignal): Promise<string> {
  const data = await request<{ stateInstance?: string }>(endpoint(credentials, 'getStateInstance'), { signal })
  if (!data?.stateInstance) throw new Error('GREEN-API не вернул статус инстанса.')
  return data.stateInstance
}

export async function getQr(credentials: Credentials, signal?: AbortSignal): Promise<QrResponse> {
  return request<QrResponse>(endpoint(credentials, 'qr'), { signal })
}

export async function sendAuthorizationPassword(credentials: Credentials, password: string): Promise<void> {
  const data = await request<PasswordResponse>(endpoint(credentials, 'sendAuthorizationPassword'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (data?.status === false || data?.data?.status === 'fail') {
    throw new Error(humanizeApiError(data.data?.reason || 'Не удалось подтвердить пароль'))
  }
}

export async function checkAccount(credentials: Credentials, phone: string): Promise<CheckAccountResponse> {
  const data = await request<CheckAccountResponse>(endpoint(credentials, 'checkAccount'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber: Number(phone) }),
  })
  if (data?.status === false) {
    throw new Error(humanizeApiError(data.reason || data.data?.reason || 'Не удалось проверить номер'))
  }
  if (!data?.exist || !data.chatId) {
    throw new Error('На этом номере нет аккаунта Telegram, или номер скрыт настройками приватности.')
  }
  return data
}

export async function sendTextMessage(credentials: Credentials, chatId: string, message: string): Promise<string> {
  const data = await request<{ idMessage?: string }>(endpoint(credentials, 'sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, message }),
  })
  if (!data?.idMessage) throw new Error('GREEN-API не подтвердил отправку сообщения.')
  return data.idMessage
}

export async function receiveNotification(
  credentials: Credentials,
  signal: AbortSignal,
): Promise<IncomingNotification | null> {
  const data = await request<IncomingNotification | null>(
    `${endpoint(credentials, 'receiveNotification')}?receiveTimeout=5`,
    { signal },
  )
  if (!data?.receiptId || !data.body) return null
  return data
}

export async function deleteNotification(
  credentials: Credentials,
  receiptId: number,
  signal: AbortSignal,
): Promise<void> {
  await request(endpoint(credentials, 'deleteNotification', String(receiptId)), {
    method: 'DELETE',
    signal,
  })
}

export async function ensureIncomingWebhook(credentials: Credentials): Promise<boolean> {
  if (isWebhookPrepared(credentials.idInstance)) return false

  const settings = await request<SettingsResponse>(endpoint(credentials, 'getSettings'))
  const webhookUrl = settings?.webhookUrl?.trim() ?? ''
  if (!webhookUrl && settings?.incomingWebhook === 'yes') {
    markWebhookPrepared(credentials.idInstance)
    return false
  }

  const saved = await request<SettingsResponse>(endpoint(credentials, 'setSettings'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ webhookUrl: '', incomingWebhook: 'yes' }),
  })
  if (saved?.saveSettings === false) {
    throw new Error('Не удалось включить получение входящих сообщений.')
  }
  markWebhookPrepared(credentials.idInstance)
  return true
}

function endpoint(credentials: Credentials, method: string, suffix = ''): string {
  const apiUrl = credentials.apiUrl.replace(/\/+$/, '')
  const tail = suffix ? `/${suffix}` : ''
  return `${apiUrl}/waInstance${credentials.idInstance}/${method}/${credentials.apiTokenInstance}${tail}`
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { cache: 'no-store', ...init })
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new Error(humanizeApiError(error), { cause: error })
  }

  const text = await response.text()
  const data = parseBody(text)
  if (!response.ok) throw new Error(humanizeApiError(extractErrorMessage(data, response.status)))
  return data as T
}

function parseBody(text: string): unknown {
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function extractErrorMessage(data: unknown, status: number): string {
  if (typeof data === 'string' && data.trim()) return data
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    for (const key of ['message', 'error', 'reason', 'detail', 'description']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) return value
    }
    if (record.data && typeof record.data === 'object') {
      const reason = (record.data as Record<string, unknown>).reason
      if (typeof reason === 'string' && reason.trim()) return reason
    }
  }
  return `Ошибка запроса (${status})`
}
