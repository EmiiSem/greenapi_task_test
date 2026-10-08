import { Fragment, useEffect, useReducer, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { checkAccount, deleteNotification, receiveNotification, sendTextMessage } from '../api/greenApi.ts'
import { createMessengerState, findChat, messengerReducer } from '../messengerState.ts'
import { loadChats, loadMessages, saveChats, saveMessages } from '../storage.ts'
import type { Chat, ChatMessage, Credentials } from '../types.ts'
import {
  avatarColor,
  chatSubtitle,
  formatDay,
  formatListTime,
  formatPhone,
  formatTime,
  humanizeApiError,
  initials,
  isAbortError,
  normalizePhone,
  sleep,
} from '../utils.ts'

interface MessengerProps {
  credentials: Credentials
  notice: string
  onLogout: () => void
}

export function Messenger({ credentials, notice, onLogout }: MessengerProps) {
  const [state, dispatch] = useReducer(messengerReducer, credentials.idInstance, (idInstance) =>
    createMessengerState(loadChats(idInstance), loadMessages(idInstance)),
  )
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [composerError, setComposerError] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [banner, setBanner] = useState(notice)
  const [pollError, setPollError] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const sendingRef = useRef(false)

  useEffect(() => {
    saveChats(credentials.idInstance, state.chats)
    saveMessages(credentials.idInstance, state.messages)
  }, [credentials.idInstance, state.chats, state.messages])

  useEffect(() => {
    const controller = new AbortController()
    let stopped = false

    async function poll() {
      while (!stopped) {
        try {
          const notification = await receiveNotification(credentials, controller.signal)
          if (stopped) return
          if (notification) {
            dispatch({ type: 'incoming', notification })
            await deleteNotification(credentials, notification.receiptId, controller.signal)
          }
          setPollError('')
        } catch (error) {
          if (stopped || isAbortError(error)) return
          setPollError(humanizeApiError(error))
          try {
            await sleep(3000, controller.signal)
          } catch {
            return
          }
        }
      }
    }

    void poll()
    return () => {
      stopped = true
      controller.abort()
    }
  }, [credentials])

  const activeChat = state.chats.find((chat) => chat.id === state.activeChatId) ?? null
  const activeMessages = state.messages
    .filter((message) => message.chatLocalId === activeChat?.id)
    .sort((left, right) => left.timestamp - right.timestamp)
  const tailId = activeMessages.at(-1)?.id ?? ''

  useEffect(() => {
    bottomRef.current?.scrollIntoView()
  }, [tailId, activeChat?.id])

  useEffect(() => {
    const node = inputRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, 160)}px`
  }, [draft, activeChat?.id])

  const visibleChats = [...state.chats]
    .sort((left, right) => activity(right, state.messages) - activity(left, state.messages))
    .filter((chat) => {
      const needle = query.trim().toLowerCase()
      if (!needle) return true
      return `${chat.title} ${chat.phone} ${chat.username}`.toLowerCase().includes(needle)
    })

  async function createChat(rawPhone: string) {
    const phone = normalizePhone(rawPhone)
    if (phone.length < 10 || phone.length > 15) {
      throw new Error('Введите номер в международном формате, например 79001234567.')
    }
    const existing = findChat(state.chats, phone, `${phone}@c.us`)
    if (existing) {
      dispatch({ type: 'select', chatId: existing.id })
      return
    }
    const account = await checkAccount(credentials, phone)
    const chatId = account.chatId ?? `${phone}@c.us`
    const same = findChat(state.chats, phone, chatId)
    if (same) {
      dispatch({ type: 'select', chatId: same.id })
      return
    }
    const username = (account.username ?? '').replace(/^@/, '')
    dispatch({
      type: 'add-chat',
      chat: {
        id: crypto.randomUUID(),
        chatId,
        phone: account.phoneNumber ? String(account.phoneNumber) : phone,
        title: username || formatPhone(phone),
        username,
        unread: 0,
        createdAt: Date.now(),
      },
    })
  }

  async function deliver(text: string, localId: string, telegramChatId: string, chatLocalId: string, isRetry: boolean) {
    if (isRetry) dispatch({ type: 'retry', localId })
    else {
      dispatch({
        type: 'send-start',
        message: {
          id: localId,
          chatLocalId,
          text,
          outgoing: true,
          timestamp: Date.now(),
          status: 'sending',
        },
      })
      setDraft('')
    }

    try {
      const serverId = await sendTextMessage(credentials, telegramChatId, text)
      dispatch({ type: 'send-success', localId, serverId })
    } catch (error) {
      dispatch({ type: 'send-fail', localId })
      setComposerError(humanizeApiError(error))
    }
  }

  async function handleSend() {
    const text = draft.trim()
    if (!activeChat || !text || sendingRef.current) return
    if (text.length > 4096) {
      setComposerError('Текст сообщения должен быть не длиннее 4096 символов.')
      return
    }
    sendingRef.current = true
    try {
      await deliver(text, crypto.randomUUID(), activeChat.chatId, activeChat.id, false)
    } finally {
      sendingRef.current = false
    }
  }

  async function retryMessage(message: ChatMessage) {
    const chat = state.chats.find((item) => item.id === message.chatLocalId)
    if (!chat || sendingRef.current) return
    sendingRef.current = true
    try {
      await deliver(message.text, message.id, chat.chatId, chat.id, true)
    } finally {
      sendingRef.current = false
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void handleSend()
    }
  }

  return (
    <div className={activeChat ? 'messenger is-open' : 'messenger'}>
      {pollError ? (
        <div className="banner banner--error">{pollError}</div>
      ) : (
        banner && (
          <div className="banner">
            <span>{banner}</span>
            <button type="button" onClick={() => setBanner('')}>
              Скрыть
            </button>
          </div>
        )
      )}
      <div className="messenger__body">
        <aside className="sidebar">
          <div className="sidebar__header">
            <div className="sidebar__brand">
              <span className="sidebar__title">Telegram</span>
              <button type="button" className="logout" onClick={onLogout}>
                Выйти
              </button>
            </div>
            <input
              className="search"
              placeholder="Поиск"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="chat-list">
            {visibleChats.length === 0 ? (
              <p className="chat-list__empty">
                {state.chats.length === 0 ? 'Чатов пока нет. Создайте диалог по номеру телефона.' : 'Ничего не найдено'}
              </p>
            ) : (
              visibleChats.map((chat) => {
                const preview = lastMessage(state.messages, chat.id)
                return (
                  <button
                    key={chat.id}
                    type="button"
                    className={chat.id === activeChat?.id ? 'chat-item is-active' : 'chat-item'}
                    onClick={() => dispatch({ type: 'select', chatId: chat.id })}
                  >
                    <span className="avatar" style={{ background: avatarColor(chat.chatId || chat.phone) }}>
                      {initials(chat.title)}
                    </span>
                    <span className="chat-item__body">
                      <span className="chat-item__line">
                        <span className="chat-item__name">{chat.title}</span>
                        <span className="chat-item__time">
                          {preview ? formatListTime(preview.timestamp) : formatListTime(chat.createdAt)}
                        </span>
                      </span>
                      <span className="chat-item__line">
                        <span className="chat-item__preview">{preview?.text || 'Нет сообщений'}</span>
                        {chat.unread > 0 && <span className="badge">{chat.unread > 99 ? '99+' : chat.unread}</span>}
                      </span>
                    </span>
                  </button>
                )
              })
            )}
          </div>
          <button type="button" className="fab" aria-label="Новый чат" onClick={() => setDialogOpen(true)}>
            <PencilIcon />
          </button>
        </aside>

        <section className="dialog">
          {activeChat ? (
            <>
              <header className="dialog__header">
                <button type="button" className="back" aria-label="К списку чатов" onClick={() => dispatch({ type: 'select', chatId: null })}>
                  <BackIcon />
                </button>
                <span className="avatar avatar--small" style={{ background: avatarColor(activeChat.chatId || activeChat.phone) }}>
                  {initials(activeChat.title)}
                </span>
                <div>
                  <div className="dialog__name">{activeChat.title}</div>
                  <div className="dialog__sub">{chatSubtitle(activeChat)}</div>
                </div>
              </header>
              <div className="messages">
                <div className="messages__sheet">
                {groupByDay(activeMessages).map((group) => (
                  <Fragment key={group.label}>
                    <div className="day">{group.label}</div>
                    {group.items.map((message) => (
                      <article key={message.id} className={message.outgoing ? 'message is-out' : 'message'}>
                        <div
                          className={`bubble ${message.outgoing ? 'bubble--out' : 'bubble--in'}${message.status === 'failed' ? ' bubble--failed' : ''}`}
                        >
                          {message.text}
                          <span className="bubble__meta">
                            {formatTime(message.timestamp)}
                            {message.outgoing && message.status !== 'failed' && (
                              <CheckIcon sent={message.status === 'sent'} />
                            )}
                          </span>
                          {message.status === 'failed' && (
                            <button type="button" className="bubble__retry" onClick={() => void retryMessage(message)}>
                              Не отправлено. Повторить
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  </Fragment>
                ))}
                <div ref={bottomRef} />
                </div>
              </div>
              {composerError && <p className="composer__error">{composerError}</p>}
              <form
                className="composer"
                onSubmit={(event: FormEvent) => {
                  event.preventDefault()
                  void handleSend()
                }}
              >
                <textarea
                  ref={inputRef}
                  rows={1}
                  placeholder="Сообщение"
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value)
                    setComposerError('')
                  }}
                  onKeyDown={onComposerKeyDown}
                />
                <button className="send" type="submit" aria-label="Отправить" disabled={!draft.trim()}>
                  <SendIcon />
                </button>
              </form>
            </>
          ) : (
            <div className="placeholder">
              <PlaneIcon />
              <p>Выберите чат, чтобы начать общение</p>
            </div>
          )}
        </section>
      </div>
      {dialogOpen && <NewChatDialog onClose={() => setDialogOpen(false)} onCreate={createChat} />}
    </div>
  )
}

function NewChatDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (phone: string) => Promise<void> }) {
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onCreate(phone)
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Не удалось создать чат')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal" onClick={onClose}>
      <form className="modal__card" onClick={(event) => event.stopPropagation()} onSubmit={(event) => void handleSubmit(event)}>
        <h2>Новый чат</h2>
        <p>Номер получателя в международном формате.</p>
        <input
          autoFocus
          inputMode="tel"
          placeholder="79001234567"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
        {error && <p className="modal__error">{error}</p>}
        <div className="modal__actions">
          <button type="button" className="modal__cancel" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="modal__submit" disabled={busy || !phone.trim()}>
            {busy ? 'Проверка…' : 'Создать'}
          </button>
        </div>
      </form>
    </div>
  )
}

function activity(chat: Chat, messages: ChatMessage[]): number {
  return lastMessage(messages, chat.id)?.timestamp ?? chat.createdAt
}

function lastMessage(messages: ChatMessage[], chatId: string): ChatMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].chatLocalId === chatId) return messages[index]
  }
  return undefined
}

function groupByDay(messages: ChatMessage[]): Array<{ label: string; items: ChatMessage[] }> {
  const groups: Array<{ label: string; items: ChatMessage[] }> = []
  for (const message of messages) {
    const label = formatDay(message.timestamp)
    const last = groups.at(-1)
    if (!last || last.label !== label) groups.push({ label, items: [message] })
    else last.items.push(message)
  }
  return groups
}

function PlaneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3.4 10.2 15.6 12 3.4 13.8z" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3.4 10.2 15.6 12 3.4 13.8z" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
      />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12z" />
    </svg>
  )
}

function CheckIcon({ sent }: { sent: boolean }) {
  return (
    <svg className={sent ? 'checks is-sent' : 'checks'} viewBox="0 0 18 11" aria-hidden="true">
      <path d="M1 6.2 3.8 9 10.5 2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      {sent && <path d="M6.2 6.2 9 9 15.8 2" fill="none" stroke="currentColor" strokeWidth="1.6" />}
    </svg>
  )
}
