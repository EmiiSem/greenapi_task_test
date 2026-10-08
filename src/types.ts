export interface Credentials {
  idInstance: string
  apiTokenInstance: string
  apiUrl: string
}

export interface Chat {
  id: string
  chatId: string
  phone: string
  title: string
  username: string
  unread: number
  createdAt: number
}

export interface ChatMessage {
  id: string
  serverId?: string
  chatLocalId: string
  text: string
  outgoing: boolean
  timestamp: number
  status: 'sending' | 'sent' | 'failed'
}

export interface MessageData {
  typeMessage?: string
  textMessageData?: { textMessage?: string }
  extendedTextMessageData?: { text?: string }
}

export interface SenderData {
  chatId?: string
  chatName?: string
  sender?: string
  senderName?: string
  senderContactName?: string
  senderPhoneNumber?: number
}

export interface NotificationBody {
  typeWebhook?: string
  timestamp?: number
  idMessage?: string
  senderData?: SenderData
  messageData?: MessageData
}

export interface IncomingNotification {
  receiptId: number
  body?: NotificationBody
}
