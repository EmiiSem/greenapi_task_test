import type { Chat, Credentials, NotificationBody } from './types.ts'

export const DEFAULT_CREDENTIALS: Credentials = {
  idInstance: '410022759039',
  apiTokenInstance: '238e4460abd74581be59dc20f065a30119921d08a9874bf5a6',
  apiUrl: 'https://4100.api.green-api.com',
}

const AVATAR_COLORS = ['#e17076', '#7bc862', '#65aadd', '#a695e7', '#ee7aae', '#6ec9cb', '#faa774']

export function validateCredentials(credentials: Credentials): string | null {
  if (!/^\d+$/.test(credentials.idInstance)) return 'idInstance должен содержать только цифры.'
  if (!credentials.apiTokenInstance.trim()) return 'Укажите apiTokenInstance.'
  try {
    const url = new URL(credentials.apiUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return 'apiUrl должен начинаться с http:// или https://.'
    }
  } catch {
    return 'Укажите корректный apiUrl.'
  }
  return null
}

export function normalizeCredentials(input: Credentials): Credentials {
  return {
    idInstance: input.idInstance.trim(),
    apiTokenInstance: input.apiTokenInstance.trim(),
    apiUrl: input.apiUrl.trim().replace(/\/+$/, ''),
  }
}

export function normalizePhone(input: string): string {
  let digits = input.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`
  return digits
}

export function formatPhone(phone: string): string {
  if (phone.length === 11 && phone.startsWith('7')) {
    return `+7 ${phone.slice(1, 4)} ${phone.slice(4, 7)}-${phone.slice(7, 9)}-${phone.slice(9)}`
  }
  return phone ? `+${phone}` : ''
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export function formatListTime(timestamp: number): string {
  const date = new Date(timestamp)
  if (sameDay(date, new Date())) return formatTime(timestamp)
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

export function formatDay(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (sameDay(date, today)) return 'Сегодня'
  if (sameDay(date, yesterday)) return 'Вчера'
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

export function avatarColor(seed: string): string {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

export function initials(title: string): string {
  const letter = title.trim().charAt(0)
  if (!letter) return '#'
  return letter.toLocaleUpperCase('ru-RU')
}

export function humanizeApiError(error: unknown): string {
  const raw = typeof error === 'string' ? error : error instanceof Error ? error.message : 'Неизвестная ошибка'
  if (raw.includes('custom webhook url is set')) {
    return 'В инстансе указан webhook. Для получения сообщений через HTTP API очистите webhookUrl в кабинете GREEN-API.'
  }
  if (/not authorized|notAuthorized|instance is starting/i.test(raw)) {
    return 'Инстанс не авторизован или ещё запускается. Подключите Telegram и повторите попытку.'
  }
  if (/rate_limit|Rate limited/i.test(raw)) {
    return 'Слишком много запросов к Telegram. Подождите и повторите попытку.'
  }
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(raw)) {
    return 'Нет соединения с GREEN-API. Проверьте apiUrl и доступ в интернет.'
  }
  if (/invalid_password/i.test(raw)) return 'Неверный пароль двухфакторной защиты.'
  if (/not_ready/i.test(raw)) return 'Инстанс ещё не готов. Запрос повторится автоматически.'
  if (/connection_closed/i.test(raw)) return 'Telegram отклонил запрос. Повторяем попытку.'
  if (/timeout/i.test(raw)) return 'Серверы Telegram не ответили. Повторяем запрос.'
  return raw
}

export function describeInstanceState(state: string): string {
  switch (state) {
    case 'notAuthorized':
      return 'Инстанс не авторизован. Подключите Telegram по QR-коду.'
    case 'blocked':
      return 'Инстанс заблокирован в GREEN-API.'
    case 'suspended':
      return 'На аккаунт Telegram наложены временные ограничения.'
    case 'starting':
      return 'Инстанс запускается. Это может занять несколько минут.'
    case 'pendingPassword':
      return 'Для завершения входа нужен облачный пароль Telegram.'
    default:
      return `Статус инстанса: ${state}`
  }
}

export function toUnixMs(timestamp?: number): number {
  if (!timestamp) return Date.now()
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp
}

export function extractIncomingText(body: NotificationBody | undefined): string | null {
  if (!body || body.typeWebhook !== 'incomingMessageReceived') return null
  const data = body.messageData
  if (!data) return null
  const type = data.typeMessage
  if (type && type !== 'textMessage' && type !== 'extendedTextMessage' && type !== 'quotedMessage') return null
  const text = data.textMessageData?.textMessage ?? data.extendedTextMessageData?.text
  return text?.trim() ? text : null
}

export function isGenericTitle(title: string, phone: string): boolean {
  return !title || title === phone || title === formatPhone(phone) || title === `+${phone}` || title === 'Новый чат'
}

export function chatSubtitle(chat: Chat): string {
  const phone = formatPhone(chat.phone)
  const username = chat.username.replace(/^@/, '')
  if (username && phone) return `${phone} · @${username}`
  if (username) return `@${username}`
  return phone || 'личный чат'
}

export function toQrSrc(message: string): string {
  const value = message.replace(/\s/g, '')
  if (value.startsWith('data:image') || value.startsWith('http')) return value
  return `data:image/png;base64,${value}`
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function sameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}
