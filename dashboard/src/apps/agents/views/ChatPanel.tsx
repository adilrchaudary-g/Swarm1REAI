import { useState, useRef, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Send, Bot, User, Check, X, Loader2, MessageSquare, ChevronDown, Zap } from 'lucide-react'
import { hermesClient } from '../../../api/hermes-client'
import type { ConversationMessage, ChatResponse, Conversation } from '../../../api/types'

const AGENT_META: Record<string, { label: string; color: string }> = {
  lead_manager: { label: 'Lead Manager', color: '#22c55e' },
  analyst: { label: 'Analyst', color: '#f59e0b' },
  orchestrator: { label: 'System', color: '#6366f1' },
}

export function ChatPanel() {
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const { data: conversations = [] } = useQuery({
    queryKey: ['chat-conversations'],
    queryFn: () => hermesClient.chat.conversations(),
  })

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMutation = useMutation({
    mutationFn: (message: string) => hermesClient.chat.send(message, conversationId ?? undefined),
    onMutate: (message) => {
      const userMsg: ConversationMessage = {
        id: Date.now(),
        conversation_id: conversationId ?? 0,
        role: 'user',
        agent_type: null,
        content: message,
        metadata_json: null,
        metadata: null,
        created_at: new Date().toISOString(),
      }
      setMessages(prev => [...prev, userMsg])
    },
    onSuccess: (data: ChatResponse) => {
      setConversationId(data.conversation_id)
      const agentMsg: ConversationMessage = {
        id: Date.now() + 1,
        conversation_id: data.conversation_id,
        role: 'agent',
        agent_type: data.agent_type,
        content: data.content,
        metadata_json: null,
        metadata: {
          actions_taken: data.actions_taken,
          confirmation: data.confirmation,
          data: data.data,
        },
        created_at: new Date().toISOString(),
      }
      setMessages(prev => [...prev, agentMsg])
      queryClient.invalidateQueries({ queryKey: ['chat-conversations'] })
    },
    onError: (err) => {
      const errMsg: ConversationMessage = {
        id: Date.now() + 1,
        conversation_id: conversationId ?? 0,
        role: 'agent',
        agent_type: 'orchestrator',
        content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}`,
        metadata_json: null,
        metadata: null,
        created_at: new Date().toISOString(),
      }
      setMessages(prev => [...prev, errMsg])
    },
  })

  const confirmMutation = useMutation({
    mutationFn: (confirmationId: number) => hermesClient.chat.confirm(confirmationId),
    onSuccess: (data) => {
      const msg: ConversationMessage = {
        id: Date.now(),
        conversation_id: data.conversation_id,
        role: 'agent',
        agent_type: 'orchestrator',
        content: 'Action confirmed and executed.',
        metadata_json: null,
        metadata: { confirmed: true },
        created_at: new Date().toISOString(),
      }
      setMessages(prev => [...prev, msg])
    },
  })

  const cancelMutation = useMutation({
    mutationFn: (confirmationId: number) => hermesClient.chat.cancel(confirmationId),
    onSuccess: (data) => {
      const msg: ConversationMessage = {
        id: Date.now(),
        conversation_id: data.conversation_id,
        role: 'agent',
        agent_type: 'orchestrator',
        content: 'Action cancelled.',
        metadata_json: null,
        metadata: { cancelled: true },
        created_at: new Date().toISOString(),
      }
      setMessages(prev => [...prev, msg])
    },
  })

  function handleSend() {
    const msg = input.trim()
    if (!msg || sendMutation.isPending) return
    setInput('')
    sendMutation.mutate(msg)
  }

  function loadConversation(conv: Conversation) {
    setConversationId(conv.id)
    setShowHistory(false)
    hermesClient.chat.messages(conv.id).then(data => {
      setMessages(data.messages)
    })
  }

  function startNewConversation() {
    setConversationId(null)
    setMessages([])
    setShowHistory(false)
    inputRef.current?.focus()
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: 'calc(100vh - 130px)',
      background: 'rgba(255,255,255,0.01)',
      border: '1px solid rgba(255,255,255,0.04)',
      borderRadius: 16,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'rgba(255,255,255,0.02)',
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Zap size={18} color="#fff" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>
            Swarm AI
          </div>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            Lead Manager &middot; Dashboard Analyst
          </div>
        </div>

        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowHistory(!showHistory)}
            style={{
              padding: '6px 12px', border: 'none', borderRadius: 8,
              background: 'rgba(255,255,255,0.04)', color: '#94a3b8',
              fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <MessageSquare size={14} />
            History
            <ChevronDown size={12} style={{ transform: showHistory ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
          </button>

          {showHistory && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 4,
              width: 280, maxHeight: 300, overflowY: 'auto',
              background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              zIndex: 20, padding: 4,
            }}>
              <button
                onClick={startNewConversation}
                style={{
                  width: '100%', padding: '10px 12px', border: 'none', borderRadius: 8,
                  background: 'rgba(99,102,241,0.1)', color: '#a5b4fc',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
                  marginBottom: 4,
                }}
              >
                + New Conversation
              </button>
              {conversations.map(conv => (
                <button
                  key={conv.id}
                  onClick={() => loadConversation(conv)}
                  style={{
                    width: '100%', padding: '8px 12px', border: 'none', borderRadius: 6,
                    background: conv.id === conversationId ? 'rgba(99,102,241,0.08)' : 'transparent',
                    color: '#cbd5e1', fontSize: 12, cursor: 'pointer', textAlign: 'left',
                    display: 'block',
                  }}
                >
                  <div style={{
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontWeight: conv.id === conversationId ? 600 : 400,
                  }}>
                    {conv.title || 'Untitled'}
                  </div>
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
                    {conv.message_count} messages &middot; {new Date(conv.updated_at).toLocaleDateString()}
                  </div>
                </button>
              ))}
              {conversations.length === 0 && (
                <div style={{ padding: 16, textAlign: 'center', fontSize: 11, color: '#475569' }}>
                  No conversations yet
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '16px 20px',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        {messages.length === 0 && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 16,
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: 16,
              background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(139,92,246,0.1))',
              border: '1px solid rgba(99,102,241,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Zap size={28} color="#6366f1" />
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#e2e8f0', marginBottom: 6 }}>
                What can I help with?
              </div>
              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
                Ask me to assign leads, check KPIs, review caller performance, or manage your pipeline.
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', maxWidth: 500 }}>
              {[
                'Give me 1000 leads to call',
                'How many calls did we make today?',
                'Is Brayden actually dialing?',
                'How many leads are queued?',
                'Give me a daily digest',
                'What follow-ups are overdue?',
              ].map(suggestion => (
                <button
                  key={suggestion}
                  onClick={() => { setInput(suggestion); inputRef.current?.focus() }}
                  style={{
                    padding: '7px 14px', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 20, background: 'rgba(255,255,255,0.03)',
                    color: '#94a3b8', fontSize: 12, cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <ChatMessage
            key={msg.id}
            message={msg}
            onConfirm={(id) => confirmMutation.mutate(id)}
            onCancel={(id) => cancelMutation.mutate(id)}
            confirmPending={confirmMutation.isPending}
          />
        ))}

        {sendMutation.isPending && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 16px',
          }}>
            <Loader2 size={16} color="#6366f1" style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 12, color: '#64748b' }}>Thinking...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '12px 20px 16px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        <div style={{
          display: 'flex', gap: 8,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12,
          padding: '4px 4px 4px 16px',
          alignItems: 'flex-end',
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="Ask Swarm AI anything..."
            rows={1}
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              color: '#e2e8f0', fontSize: 14, resize: 'none',
              padding: '10px 0', lineHeight: 1.4,
              maxHeight: 120, overflowY: 'auto',
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sendMutation.isPending}
            style={{
              width: 40, height: 40, borderRadius: 10, border: 'none',
              background: input.trim() ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'rgba(255,255,255,0.04)',
              color: input.trim() ? '#fff' : '#475569',
              cursor: input.trim() ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s', flexShrink: 0,
            }}
          >
            <Send size={16} />
          </button>
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
      `}</style>
    </div>
  )
}

function ChatMessage({ message, onConfirm, onCancel, confirmPending }: {
  message: ConversationMessage
  onConfirm: (id: number) => void
  onCancel: (id: number) => void
  confirmPending: boolean
}) {
  const isUser = message.role === 'user'
  const agentMeta = message.agent_type ? AGENT_META[message.agent_type] : null
  const confirmation = message.metadata?.confirmation

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      gap: 8,
    }}>
      {!isUser && (
        <div style={{
          width: 30, height: 30, borderRadius: 8, flexShrink: 0, marginTop: 2,
          background: agentMeta ? `${agentMeta.color}18` : 'rgba(99,102,241,0.1)',
          border: `1px solid ${agentMeta ? `${agentMeta.color}30` : 'rgba(99,102,241,0.2)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Bot size={15} color={agentMeta?.color ?? '#6366f1'} />
        </div>
      )}

      <div style={{
        maxWidth: '75%',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        {!isUser && agentMeta && (
          <span style={{
            fontSize: 10, fontWeight: 600, color: agentMeta.color,
            textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            {agentMeta.label}
          </span>
        )}

        <div style={{
          padding: '10px 14px',
          borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
          background: isUser
            ? 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.15))'
            : 'rgba(255,255,255,0.04)',
          border: isUser
            ? '1px solid rgba(99,102,241,0.25)'
            : '1px solid rgba(255,255,255,0.06)',
          color: '#e2e8f0',
          fontSize: 13,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {message.content}
        </div>

        {/* Confirmation card */}
        {confirmation && !message.metadata?.confirmed && !message.metadata?.cancelled && (
          <div style={{
            padding: 12, borderRadius: 10,
            background: 'rgba(234,179,8,0.06)',
            border: '1px solid rgba(234,179,8,0.2)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#eab308', marginBottom: 6 }}>
              Requires Confirmation
            </div>
            <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 10 }}>
              {confirmation.description}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => onConfirm(confirmation.id)}
                disabled={confirmPending}
                style={{
                  padding: '7px 16px', border: 'none', borderRadius: 8,
                  background: '#22c55e', color: '#fff',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4,
                  opacity: confirmPending ? 0.5 : 1,
                }}
              >
                <Check size={14} /> Confirm
              </button>
              <button
                onClick={() => onCancel(confirmation.id)}
                disabled={confirmPending}
                style={{
                  padding: '7px 16px', border: 'none', borderRadius: 8,
                  background: 'rgba(239,68,68,0.15)', color: '#f87171',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4,
                  opacity: confirmPending ? 0.5 : 1,
                }}
              >
                <X size={14} /> Cancel
              </button>
            </div>
          </div>
        )}

        {message.metadata?.confirmed && (
          <div style={{
            padding: '6px 10px', borderRadius: 6, fontSize: 11,
            background: 'rgba(34,197,94,0.08)', color: '#22c55e', fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <Check size={12} /> Confirmed
          </div>
        )}

        {message.metadata?.cancelled && (
          <div style={{
            padding: '6px 10px', borderRadius: 6, fontSize: 11,
            background: 'rgba(239,68,68,0.08)', color: '#ef4444', fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <X size={12} /> Cancelled
          </div>
        )}

        <span style={{ fontSize: 10, color: '#475569' }}>
          {new Date(message.created_at).toLocaleTimeString('en-US', {
            hour: 'numeric', minute: '2-digit',
          })}
        </span>
      </div>

      {isUser && (
        <div style={{
          width: 30, height: 30, borderRadius: 8, flexShrink: 0, marginTop: 2,
          background: 'rgba(99,102,241,0.15)',
          border: '1px solid rgba(99,102,241,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <User size={15} color="#818cf8" />
        </div>
      )}
    </div>
  )
}
