import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Bot, User, Loader2, Trash2, Zap } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../api/client';
import ClawForgeLogo from '../../components/ClawForgeLogo';

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  source?: string;
  model?: string;
}

const STORAGE_KEY = 'openclaw_portal_chat';
const WARM_KEY = 'openclaw_agent_connected';

function loadMessages(userId: string): Message[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}_${userId}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveMessages(userId: string, messages: Message[]) {
  localStorage.setItem(`${STORAGE_KEY}_${userId}`, JSON.stringify(messages));
}
function isAgentWarm(userId: string): boolean {
  return localStorage.getItem(`${WARM_KEY}_${userId}`) === 'true';
}
function markAgentWarm(userId: string) {
  localStorage.setItem(`${WARM_KEY}_${userId}`, 'true');
}

// ── Warmup indicator — only shown on first-ever connection ──────────────────

function WarmupIndicator() {
  const [visible, setVisible] = useState(false);
  const [remaining, setRemaining] = useState(6);

  useEffect(() => {
    const show = setTimeout(() => setVisible(true), 1000);
    return () => clearTimeout(show);
  }, []);

  useEffect(() => {
    if (!visible || remaining <= 0) return;
    const t = setInterval(() => setRemaining(r => Math.max(0, r - 1)), 1000);
    return () => clearInterval(t);
  }, [visible, remaining]);

  if (!visible) {
    return (
      <div className="rounded-xl bg-dark-card border border-dark-border px-4 py-3 flex items-center gap-2">
        <Loader2 size={13} className="animate-spin text-text-muted" />
        <span className="text-xs text-text-muted">Thinking...</span>
      </div>
    );
  }

  const pct = Math.round(((6 - remaining) / 6) * 100);
  return (
    <div className="rounded-xl bg-dark-card border border-warning/30 px-4 py-3 w-72 space-y-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-warning font-medium">
          <Zap size={12} /> Agent starting up
        </span>
        <span className="text-xs text-text-muted tabular-nums">{remaining}s</span>
      </div>
      <div className="h-1 w-full rounded-full bg-dark-border overflow-hidden">
        <div className="h-full rounded-full bg-warning transition-[width] duration-1000" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[10px] text-text-muted">First message · cold-start ~10s — subsequent responses are instant</p>
    </div>
  );
}

// ── Main Chat ───────────────────────────────────────────────────────────────

export default function PortalChat() {
  const { user } = useAuth();
  const userId = user?.id || 'unknown';

  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = loadMessages(userId);
    if (saved.length > 0) return saved;
    return [{
      id: 0, role: 'assistant',
      content: `Hello ${user?.name || 'there'}! I'm your **${user?.positionName || 'AI'} Agent** at ACME Corp.\n\nI can help you with tasks related to your ${user?.positionName || ''} role in the ${user?.departmentName || ''} department. Just type your question or request below.`,
      timestamp: new Date().toISOString(),
    }];
  });

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [warm, setWarm] = useState(() => isAgentWarm(userId));
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { saveMessages(userId, messages); }, [messages, userId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const clearChat = useCallback(() => {
    setMessages([{ id: Date.now(), role: 'assistant', content: 'Chat cleared. How can I help you?', timestamp: new Date().toISOString() }]);
  }, []);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: Message = { id: Date.now(), role: 'user', content: text, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);

    const doCall = () => api.post<{ response: string; source?: string; model?: string }>('/portal/chat', { message: text });

    try {
      const resp = await doCall();
      setMessages(prev => [...prev, {
        id: Date.now() + 1, role: 'assistant', content: resp.response,
        timestamp: new Date().toISOString(), source: resp.source, model: resp.model,
      }]);
      if (!warm) { setWarm(true); markAgentWarm(userId); }
    } catch (e: any) {
      if (e?.status === 404 || String(e?.message || '').includes('No agent bound')) {
        setMessages(prev => [...prev, {
          id: Date.now() + 1, role: 'assistant',
          content: 'Your agent is not yet configured. Please contact your IT Admin.',
          timestamp: new Date().toISOString(), source: 'error',
        }]);
        setSending(false);
        return;
      }
      try {
        await new Promise(r => setTimeout(r, 4000));
        const retry = await doCall();
        setMessages(prev => [...prev, {
          id: Date.now() + 2, role: 'assistant', content: retry.response,
          timestamp: new Date().toISOString(), source: retry.source, model: retry.model,
        }]);
        if (!warm) { setWarm(true); markAgentWarm(userId); }
      } catch {
        setMessages(prev => [...prev, {
          id: Date.now() + 2, role: 'assistant',
          content: 'Agent is still starting up. Please wait a moment and try again.',
          timestamp: new Date().toISOString(), source: 'error',
        }]);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-dark-border px-6 py-3">
        <div className="flex items-center gap-3">
          <ClawForgeLogo size={36} animate={sending ? 'working' : 'idle'} />
          <div>
            <h1 className="text-sm font-semibold text-text-primary">{user?.positionName} Agent</h1>
            <p className="text-xs text-text-muted">{user?.name} · {user?.departmentName}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${warm ? 'bg-success' : 'bg-warning'} animate-pulse`} />
            <span className={`text-xs ${warm ? 'text-success' : 'text-warning'}`}>
              {warm ? 'Connected' : 'Standby'}
            </span>
          </div>
          <button onClick={clearChat}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Clear display only — agent memory is preserved">
            <Trash2 size={14} /> Clear display
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map(msg => (
          <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
            {msg.role === 'assistant' && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary mt-1">
                <Bot size={16} />
              </div>
            )}
            <div className={`max-w-[75%] rounded-xl px-4 py-3 ${
              msg.role === 'user'
                ? 'bg-primary text-white'
                : 'bg-dark-card border border-dark-border text-text-primary'
            }`}>
              {msg.role === 'assistant' ? (
                <div className="text-sm prose prose-invert prose-sm max-w-none
                  [&_p]:my-1 [&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1
                  [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1
                  [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mt-2
                  [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5
                  [&_code]:bg-dark-bg [&_code]:px-1 [&_code]:rounded
                  [&_pre]:bg-dark-bg [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:my-2 [&_pre]:overflow-x-auto
                  [&_table]:text-xs [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1
                  [&_strong]:text-text-primary [&_a]:text-primary-light [&_hr]:border-dark-border">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              )}
              <p className={`text-[10px] mt-1.5 ${msg.role === 'user' ? 'text-white/60' : 'text-text-muted'}`}>
                {msg.role === 'user' && '✓ '}
                {new Date(msg.timestamp).toLocaleTimeString()}
                {msg.source === 'agentcore' && ' · AgentCore'}
                {msg.model && ` · ${msg.model.split('/').pop()?.split(':')[0] || ''}`}
              </p>
            </div>
            {msg.role === 'user' && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 mt-1">
                <User size={16} />
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div className="flex gap-3">
            <div className="shrink-0 mt-1"><ClawForgeLogo size={28} animate="working" /></div>
            {!warm ? <WarmupIndicator /> : (
              <div className="rounded-xl bg-dark-card border border-dark-border px-4 py-3 flex items-center gap-2">
                <Loader2 size={13} className="animate-spin text-text-muted" />
                <span className="text-xs text-text-muted">Thinking...</span>
              </div>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-dark-border px-6 py-4">
        <div className="flex gap-3">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Type your message..."
            disabled={sending}
            className="flex-1 rounded-xl border border-dark-border bg-dark-bg px-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || sending}
            className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Send size={18} />
          </button>
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-[10px] text-text-muted">Press Enter to send</p>
          <p className="text-[10px] text-text-muted">Powered by AWS Bedrock via AgentCore</p>
        </div>
      </div>
    </div>
  );
}
