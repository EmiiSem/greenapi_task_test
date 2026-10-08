import type { Chat, ChatMessage, IncomingNotification } from './types.ts'
import { extractIncomingText, formatPhone, isGenericTitle, toUnixMs } from './utils.ts'

export interface MessengerState {
  chats: Chat[]
  messages: ChatMessage[]
  activeChatId: string | null
}

export type MessengerAction =
  | { type: 'select'; chatId: string | null }
  | { type: 'add-chat'; chat: Chat }
  | { type: 'incoming'; notification: IncomingNotification }
  | { type: 'send-start'; message: ChatMessage }
  | { type: 'send-success'; localId: string; serverId: string }
  | { type: 'send-fail'; localId: string }
  | { type: 'retry'; localId: string }

export function createMessengerState(chats: Chat[], messages: ChatMessage[]): MessengerState {
  return { chats, messages, activeChatId: null }
}

export function messengerReducer(state: MessengerState, action: MessengerAction): MessengerState {
  switch (action.type) {
    case 'select':
      return {
        ...state,
        activeChatId: action.chatId,
        chats: state.chats.map((chat) => (chat.id === action.chatId ? { ...chat, unread: 0 } : chat)),
      }
    case 'add-chat':
      return { ...state, chats: [action.chat, ...state.chats], activeChatId: action.chat.id }
    case 'incoming':
      return applyIncoming(state, action.notification)
    case 'send-start':
      return { ...state, messages: [...state.messages, action.message] }
    case 'send-success':
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.localId ? { ...message, serverId: action.serverId, status: 'sent' } : message,
        ),
      }
    case 'send-fail':
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.localId ? { ...message, status: 'failed' } : message,
        ),
      }
    case 'retry':
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.localId ? { ...message, status: 'sending' } : message,
        ),
      }
    default:
      return state
  }
}

export function findChat(chats: Chat[], phone: string, telegramChatId = ''): Chat | undefined {
  return chats.find((chat) => chatMatches(chat, telegramChatId, phone))
}

function applyIncoming(state: MessengerState, notification: IncomingNotification): MessengerState {
  const text = extractIncomingText(notification.body)
  if (!text || !notification.body) return state

  const sender = notification.body.senderData ?? {}
  const telegramChatId = String(sender.chatId ?? sender.sender ?? '')
  const phone = sender.senderPhoneNumber ? String(sender.senderPhoneNumber) : ''
  const titleCandidate = [sender.senderContactName, sender.chatName, sender.senderName].find((value) => value?.trim())?.trim() ?? ''
  const messageId = notification.body.idMessage || `receipt-${notification.receiptId}`
  const timestamp = toUnixMs(notification.body.timestamp)
  const duplicate = state.messages.some((message) => message.id === messageId || message.serverId === messageId)
  const existing = findChat(state.chats, phone, telegramChatId)
  const base: Chat = existing ?? {
    id: crypto.randomUUID(),
    chatId: telegramChatId || (phone ? `${phone}@c.us` : messageId),
    phone,
    title: titleCandidate || formatPhone(phone) || 'Новый чат',
    username: '',
    unread: 0,
    createdAt: timestamp,
  }
  const nextChat: Chat = {
    ...base,
    chatId: telegramChatId || base.chatId,
    phone: base.phone || phone,
    title: isGenericTitle(base.title, base.phone) && titleCandidate ? titleCandidate : base.title,
    unread: state.activeChatId === base.id || duplicate ? base.unread : base.unread + 1,
  }
  const chats = existing
    ? state.chats.map((chat) => (chat.id === nextChat.id ? nextChat : chat))
    : [nextChat, ...state.chats]

  if (duplicate) return { ...state, chats }

  return {
    ...state,
    chats,
    messages: [
      ...state.messages,
      {
        id: messageId,
        serverId: messageId,
        chatLocalId: nextChat.id,
        text,
        outgoing: false,
        timestamp,
        status: 'sent',
      },
    ],
  }
}

function chatMatches(chat: Chat, telegramChatId: string, phone: string): boolean {
  if (telegramChatId && chat.chatId === telegramChatId) return true
  if (phone && chat.phone === phone) return true
  if (phone && chat.chatId === `${phone}@c.us`) return true
  if (telegramChatId && chat.phone && telegramChatId === `${chat.phone}@c.us`) return true
  return false
}
