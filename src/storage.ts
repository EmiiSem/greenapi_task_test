import type { Chat, ChatMessage, Credentials } from './types.ts'

const CREDENTIALS_KEY = 'greenapi.credentials'

function chatsKey(idInstance: string): string {
  return `greenapi.chats.${idInstance}`
}

function messagesKey(idInstance: string): string {
  return `greenapi.messages.${idInstance}`
}

function webhookKey(idInstance: string): string {
  return `greenapi.webhookReady.${idInstance}`
}

export function loadCredentials(): Credentials | null {
  const data = readJson(CREDENTIALS_KEY)
  if (!isRecord(data)) return null
  if (typeof data.idInstance !== 'string' || typeof data.apiTokenInstance !== 'string' || typeof data.apiUrl !== 'string') {
    return null
  }
  return {
    idInstance: data.idInstance,
    apiTokenInstance: data.apiTokenInstance,
    apiUrl: data.apiUrl,
  }
}

export function saveCredentials(credentials: Credentials): void {
  writeJson(CREDENTIALS_KEY, credentials)
}

export function clearCredentials(): void {
  localStorage.removeItem(CREDENTIALS_KEY)
}

export function loadChats(idInstance: string): Chat[] {
  const data = readJson(chatsKey(idInstance))
  return Array.isArray(data) ? data.filter(isChat) : []
}

export function saveChats(idInstance: string, chats: Chat[]): void {
  writeJson(chatsKey(idInstance), chats)
}

export function loadMessages(idInstance: string): ChatMessage[] {
  const data = readJson(messagesKey(idInstance))
  return Array.isArray(data) ? data.filter(isMessage) : []
}

export function saveMessages(idInstance: string, messages: ChatMessage[]): void {
  writeJson(messagesKey(idInstance), messages)
}

export function isWebhookPrepared(idInstance: string): boolean {
  return localStorage.getItem(webhookKey(idInstance)) === '1'
}

export function markWebhookPrepared(idInstance: string): void {
  localStorage.setItem(webhookKey(idInstance), '1')
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as unknown : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Хранилище браузера может быть недоступно или переполнено.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isChat(value: unknown): value is Chat {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.chatId === 'string'
    && typeof value.phone === 'string'
    && typeof value.title === 'string'
    && typeof value.username === 'string'
    && typeof value.unread === 'number'
    && typeof value.createdAt === 'number'
}

function isMessage(value: unknown): value is ChatMessage {
  if (!isRecord(value)) return false
  const status = value.status
  return typeof value.id === 'string'
    && typeof value.chatLocalId === 'string'
    && typeof value.text === 'string'
    && typeof value.outgoing === 'boolean'
    && typeof value.timestamp === 'number'
    && (status === 'sending' || status === 'sent' || status === 'failed')
}
