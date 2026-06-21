'use client';

/**
 * Manus-style Chat Page — Universal Agent
 * ─────────────────────────────────────────────────────────────────────────────
 * Single universal agent (the planner). The platform auto-selects tools and
 * strategies based on the user's request — there is no agent picker in the UI.
 *
 * Layout:
 *   ┌─ Sidebar (dark) ──────┐  ┌─ Main column ──────────────────────────┐
 *   │  • New Chat           │  │  Header (universal agent + stats)      │
 *   │  • Search             │  │  Messages (Markdown + Thinking + Tools)│
 *   │  • Sessions list      │  │  ChatInput (Plan Mode + Model Mode)    │
 *   └───────────────────────┘  └────────────────────────────────────────┘
 *
 * SSE events handled:
 *   started         → mark assistant message as started (thinkingActive=true)
 *   thinking        → append REAL model reasoning to `thinkingContent`
 *   message_chunk   → append to message content; mark thinkingActive=false
 *   tool_call       → push a new ToolCard (running state)
 *   tool_result     → update the matching ToolCard with result + duration
 *   completed       → finalize message; set metadata; clear isStreaming
 *   error           → mark message failed; show error
 *   cancelled       → mark streaming stopped
 *   message_saved   → swap temp id for DB id; refresh sessions list
 *
 * Backend endpoints used:
 *   POST   /api/sessions                       { agentSlug:'planner', title?, modelId? }
 *   GET    /api/sessions                       list sessions
 *   GET    /api/sessions/[id]                  session + messages
 *   DELETE /api/sessions/[id]
 *   POST   /api/sessions/[id]/messages         SSE stream
 *   GET    /api/models                         list models + capabilities
 */
import {
  useState, useEffect, useRef, useCallback, useMemo,
} from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles, AlertTriangle, Trash2, RefreshCw, Menu,
  Activity, Cpu, Coins, Lightbulb, Brain,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ChatSidebar,
  type SidebarSession,
} from '@/components/chat/ChatSidebar';
import {
  MessageBubble,
  type ChatMessageData,
} from '@/components/chat/MessageBubble';
import {
  ChatInput,
  type ModelOption,
  type ModelModeState,
} from '@/components/chat/ChatInput';
import type { ToolCallData } from '@/components/chat/ToolCard';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const UNIVERSAL_AGENT_SLUG = 'planner';
const UNIVERSAL_AGENT_NAME = 'Agent';

// ─────────────────────────────────────────────────────────────────────────────
// Types — SSE event payloads from POST /api/sessions/[id]/messages
// ─────────────────────────────────────────────────────────────────────────────
type SSEEvent =
  | { type: 'started'; agentId: string; input: { task: string } }
  | { type: 'thinking'; content: string }
  | { type: 'message_chunk'; content: string }
  | { type: 'tool_call'; toolName: string; args: unknown; toolCallId: string }
  | { type: 'tool_result'; toolName: string; result: unknown; durationMs: number }
  | { type: 'handoff_request'; target: string; reason: string }
  | { type: 'subagent_spawned'; subAgentId: string; agentType: string }
  | { type: 'error'; error: { code: string; message: string; retryable?: boolean }; recoverable: boolean }
  | { type: 'completed'; output: { content: string; metadata?: { tokensUsed: number; cost: number; durationMs: number } }; tokensUsed: number; cost: number }
  | { type: 'cancelled'; reason: string }
  | { type: 'message_saved'; messageId: string };

interface ApiSession {
  id: string;
  agentId: string;
  agentSlug?: string;
  agentName: string;
  title: string;
  status: string;
  totalTokens: number;
  totalCost: string;
  startedAt: string;
  lastActivityAt: string;
  messageCount: number;
}

interface ApiMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  modelId?: string;
  tokensInput?: number;
  tokensOutput?: number;
  cost?: string;
  latencyMs?: number;
}

interface ApiModel {
  id: string;
  name: string;
  displayName?: string;
  providerId: string;
  providerName: string;
  providerSlug: string;
  providerType: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  supportsThinking: boolean;
  supportsJsonMode: boolean;
  inputPricePer1k?: number;
  outputPricePer1k?: number;
  priority: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function apiMessageToChatMessage(m: ApiMessage): ChatMessageData {
  const role: ChatMessageData['role'] =
    m.role === 'user' ? 'user' :
    m.role === 'assistant' ? 'assistant' :
    m.role === 'system' ? 'system' : 'system';
  const tokensUsed = (m.tokensInput || 0) + (m.tokensOutput || 0);
  return {
    id: m.id,
    role,
    content: m.content || '',
    createdAt: m.createdAt,
    agentName: UNIVERSAL_AGENT_NAME,
    isStreaming: false,
    metadata: role === 'assistant' && (tokensUsed || m.cost || m.latencyMs) ? {
      tokensUsed: tokensUsed || undefined,
      cost: m.cost ? parseFloat(m.cost) : undefined,
      durationMs: m.latencyMs,
    } : undefined,
  };
}

function formatTotalCost(s: string | number): string {
  const n = typeof s === 'number' ? s : parseFloat(s);
  if (!isFinite(n) || n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(5)}`;
  return `$${n.toFixed(4)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function makeTitle(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= 50) return trimmed;
  return trimmed.slice(0, 50) + '…';
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('accessToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────────────
function EmptyChatState({ onSuggest }: { onSuggest: (s: string) => void }) {
  const suggestions = [
    'Explain how AI agents work',
    'Write a Python function to fetch and parse JSON',
    'Calculate 15 × 37 and explain the steps',
    'Help me plan a 3-day trip to Tokyo',
  ];
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 py-12">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-lg mb-4"
      >
        <Sparkles className="w-8 h-8" />
      </motion.div>
      <h2 className="text-xl font-bold mb-1 tracking-tight">
        How can I help you today?
      </h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-md">
        One universal agent. It auto-selects the right tools and strategies based on your request —
        just describe what you need.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl">
        {suggestions.map((s, i) => (
          <motion.button
            key={s}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i, duration: 0.25 }}
            onClick={() => onSuggest(s)}
            className="text-left px-4 py-3 rounded-xl border bg-card hover:bg-accent hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors text-[13px] text-foreground/80 hover:text-foreground"
          >
            {s}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
export default function ChatPage() {
  const router = useRouter();

  // ── State ──────────────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<SidebarSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentSessionMeta, setCurrentSessionMeta] = useState<ApiSession | null>(null);
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [input, setInput] = useState('');
  const [loadingData, setLoadingData] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Models + model mode (single universal agent → just model selection)
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelMode, setModelMode] = useState<ModelModeState>({
    modelId: null,
    thinkingEnabled: false,
    toolUseEnabled: true,
    jsonModeEnabled: false,
  });
  const [planMode, setPlanMode] = useState(false);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const abortRef = useRef<AbortController | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const currentAssistantIdRef = useRef<string | null>(null);
  const sessionMetaRef = useRef<ApiSession | null>(null);
  const thinkingStartedAtRef = useRef<number | null>(null);
  const modelModeRef = useRef<ModelModeState>(modelMode);
  const planModeRef = useRef<boolean>(planMode);
  sessionMetaRef.current = currentSessionMeta;
  modelModeRef.current = modelMode;
  planModeRef.current = planMode;

  // ── Auth check + initial data ──────────────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/login'); return; }
    Promise.all([
      fetch('/api/sessions', { headers: authHeaders() }).then(r => r.json()),
      fetch('/api/models', { headers: authHeaders() }).then(r => r.json()),
    ]).then(([sessionsData, modelsData]) => {
      if (sessionsData.success) {
        const mapped: SidebarSession[] = (sessionsData.data.sessions || []).map((s: ApiSession) => ({
          id: s.id,
          title: s.title || 'Untitled',
          status: s.status,
          lastActivityAt: s.lastActivityAt,
          messageCount: s.messageCount,
          totalTokens: s.totalTokens,
        }));
        setSessions(mapped);
      }
      if (modelsData.success) {
        const mapped: ModelOption[] = (modelsData.data.models || []).map((m: ApiModel) => ({
          id: m.id,
          name: m.name,
          displayName: m.displayName,
          providerName: m.providerName,
          providerSlug: m.providerSlug,
          contextWindow: m.contextWindow,
          maxOutputTokens: m.maxOutputTokens,
          supportsTools: m.supportsTools,
          supportsVision: m.supportsVision,
          supportsStreaming: m.supportsStreaming,
          supportsThinking: m.supportsThinking,
          supportsJsonMode: m.supportsJsonMode,
        }));
        // Sort: thinking-capable models first, then by provider name
        mapped.sort((a, b) => {
          if (a.supportsThinking !== b.supportsThinking) return a.supportsThinking ? -1 : 1;
          return a.providerName.localeCompare(b.providerName);
        });
        setModels(mapped);
      }
    }).catch((err) => {
      console.error('Failed to load chat data:', err);
      setError('Failed to load data. Please refresh.');
    }).finally(() => setLoadingData(false));
  }, [router]);

  // ── Auto-scroll behavior ───────────────────────────────────────────────────
  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
      block: 'end',
    });
  }, []);

  useEffect(() => {
    if (autoScrollRef.current) {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const threshold = 80;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    autoScrollRef.current = distanceFromBottom < threshold;
  }, []);

  // ── Helper: refresh sessions list ──────────────────────────────────────────
  const refreshSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions', { headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        const mapped: SidebarSession[] = (data.data.sessions || []).map((s: ApiSession) => ({
          id: s.id,
          title: s.title || 'Untitled',
          status: s.status,
          lastActivityAt: s.lastActivityAt,
          messageCount: s.messageCount,
          totalTokens: s.totalTokens,
        }));
        setSessions(mapped);
      }
    } catch (err) { console.error(err); }
  }, []);

  // ── Load session ───────────────────────────────────────────────────────────
  const loadSession = useCallback(async (sessionId: string) => {
    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/login'); return; }
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        const session: ApiSession = data.data.session;
        const apiMsgs: ApiMessage[] = data.data.messages || [];
        const mapped: ChatMessageData[] = apiMsgs.map(apiMessageToChatMessage);
        setCurrentSessionId(sessionId);
        setCurrentSessionMeta(session);
        setMessages(mapped);
        autoScrollRef.current = true;
        setTimeout(() => scrollToBottom(false), 50);
      } else if (res.status === 401) {
        router.push('/login');
      } else {
        setError(data.error?.message || 'Failed to load session');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load session');
    }
  }, [router, scrollToBottom]);

  // ── Create session ────────────────────────────────────────────────────────
  const createSession = useCallback(async (title?: string): Promise<string | null> => {
    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/login'); return null; }
    setError(null);
    try {
      const body: any = { agentSlug: UNIVERSAL_AGENT_SLUG };
      if (title) body.title = title;
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        await refreshSessions();
        return data.data.sessionId as string;
      }
      setError(data.error?.message || 'Failed to create session');
      return null;
    } catch (err: any) {
      setError(err.message || 'Failed to create session');
      return null;
    }
  }, [refreshSessions, router]);

  // ── New Chat (clears current session, shows empty state) ──────────────────
  const handleNewChat = useCallback(() => {
    setCurrentSessionId(null);
    setCurrentSessionMeta(null);
    setMessages([]);
    setError(null);
    setInput('');
  }, []);

  // ── Delete session ─────────────────────────────────────────────────────────
  const deleteSession = useCallback(async (sessionId: string) => {
    if (!confirm('Delete this chat session? This cannot be undone.')) return;
    const token = localStorage.getItem('accessToken');
    if (!token) return;
    try {
      await fetch(`/api/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
        setCurrentSessionMeta(null);
        setMessages([]);
      }
      await refreshSessions();
    } catch (err) { console.error(err); }
  }, [currentSessionId, refreshSessions]);

  // ── Send message (SSE streaming) ───────────────────────────────────────────
  const sendMessage = useCallback(async (opts: { content: string; planMode: boolean; modelMode: ModelModeState }) => {
    const { content: rawContent, planMode: pm, modelMode: mm } = opts;
    const content = rawContent.trim();
    if (!content || sending) return;

    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/login'); return; }

    setError(null);
    setInput('');
    autoScrollRef.current = true;
    thinkingStartedAtRef.current = null;

    // Ensure we have a session — create one lazily on first send.
    let sessionId = currentSessionId;
    if (!sessionId) {
      sessionId = await createSession(makeTitle(content));
      if (!sessionId) return;
      // Load the freshly-created (empty) session so the UI state matches.
      await loadSession(sessionId);
    }

    // If plan mode is ON, prepend a clear instruction so the agent plans first.
    const finalContent = pm
      ? `[Plan Mode]\n\nBefore taking any action, please outline a clear, step-by-step plan for how you'll approach this request. Wait for my confirmation only if the request is ambiguous; otherwise proceed with the plan.\n\n---\n\n${content}`
      : content;

    // Push user message immediately
    const userMsg: ChatMessageData = {
      id: `u-${Date.now()}`,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };

    // Push placeholder assistant message
    const assistantId = `a-${Date.now()}`;
    currentAssistantIdRef.current = assistantId;
    const assistantMsg: ChatMessageData = {
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
      agentName: UNIVERSAL_AGENT_NAME,
      isStreaming: true,
      thinkingContent: '',
      thinkingActive: false,
      toolCalls: [],
      artifacts: [],
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setSending(true);

    abortRef.current = new AbortController();

    // Helper to update the assistant message immutably
    const updateAssistant = (updater: (m: ChatMessageData) => ChatMessageData) => {
      setMessages(prev => prev.map(m =>
        m.id === assistantId ? updater(m) : m
      ));
    };

    try {
      const res = await fetch(`/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          content: finalContent,
          modelId: mm.modelId ?? undefined,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error?.message || `HTTP ${res.status}`);
      }
      if (!res.body) throw new Error('No response stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const startedAt = Date.now();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          if (!payload) continue;

          let event: SSEEvent;
          try {
            event = JSON.parse(payload);
          } catch {
            continue;
          }

          switch (event.type) {
            case 'started': {
              updateAssistant(m => ({
                ...m,
                thinkingActive: true,
              }));
              break;
            }
            case 'thinking': {
              // Accumulate REAL model reasoning text
              if (thinkingStartedAtRef.current === null) {
                thinkingStartedAtRef.current = Date.now();
              }
              updateAssistant(m => ({
                ...m,
                thinkingContent: (m.thinkingContent || '') + event.content,
                thinkingActive: true,
              }));
              break;
            }
            case 'message_chunk': {
              // Thinking phase is over for this turn — close it out
              const thinkStart = thinkingStartedAtRef.current;
              const thinkDur = thinkStart ? Date.now() - thinkStart : undefined;
              thinkingStartedAtRef.current = null;
              updateAssistant(m => ({
                ...m,
                content: m.content + event.content,
                thinkingActive: false,
                thinkingDurationMs: m.thinkingDurationMs === undefined
                  ? thinkDur
                  : m.thinkingDurationMs + (thinkDur ?? 0),
              }));
              break;
            }
            case 'tool_call': {
              // Tool calls pause thinking; mark it inactive if still active.
              thinkingStartedAtRef.current = null;
              updateAssistant(m => ({
                ...m,
                thinkingActive: false,
                toolCalls: [
                  ...(m.toolCalls ?? []),
                  {
                    id: event.toolCallId || `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    toolName: event.toolName,
                    args: event.args,
                    status: 'running' as const,
                  } satisfies ToolCallData,
                ],
              }));
              break;
            }
            case 'tool_result': {
              updateAssistant(m => {
                const toolCalls = (m.toolCalls ?? []).map(tc => {
                  // Match by name AND running status (most recent matching call)
                  if (tc.toolName === event.toolName && tc.status === 'running') {
                    return {
                      ...tc,
                      result: event.result,
                      durationMs: event.durationMs,
                      status: 'success' as const,
                    };
                  }
                  return tc;
                });
                return { ...m, toolCalls };
              });
              break;
            }
            case 'completed': {
              const totalDuration = Date.now() - startedAt;
              updateAssistant(m => ({
                ...m,
                isStreaming: false,
                thinkingActive: false,
                content: m.content || event.output?.content || '',
                metadata: {
                  tokensUsed: event.tokensUsed || event.output?.metadata?.tokensUsed,
                  cost: event.cost ?? event.output?.metadata?.cost,
                  durationMs: event.output?.metadata?.durationMs ?? totalDuration,
                },
              }));
              break;
            }
            case 'error': {
              const errMsg = event.error?.message || 'Agent error';
              updateAssistant(m => ({
                ...m,
                isStreaming: false,
                thinkingActive: false,
                isError: true,
                content: m.content
                  ? m.content + `\n\n⚠️ **Error:** ${errMsg}`
                  : `⚠️ **Error:** ${errMsg}`,
              }));
              setError(errMsg);
              break;
            }
            case 'cancelled': {
              updateAssistant(m => ({
                ...m,
                isStreaming: false,
                thinkingActive: false,
                content: m.content + '\n\n_(stopped by user)_',
              }));
              break;
            }
            case 'message_saved': {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, id: event.messageId } : m
              ));
              currentAssistantIdRef.current = event.messageId;
              refreshSessions();
              break;
            }
          }
        }
      }

      // If no content arrived, show a fallback
      updateAssistant(m => {
        if (m.content || m.toolCalls?.length || m.artifacts?.length) return m;
        return { ...m, content: '_(No response received)_', isStreaming: false };
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        updateAssistant(m => ({
          ...m,
          isStreaming: false,
          thinkingActive: false,
          content: (m.content || '') + '\n\n_(stopped by user)_',
        }));
      } else {
        const msg = err.message || 'Network error';
        updateAssistant(m => ({
          ...m,
          isStreaming: false,
          thinkingActive: false,
          isError: true,
          content: m.content
            ? m.content + `\n\n⚠️ **Error:** ${msg}`
            : `⚠️ **Error:** ${msg}`,
        }));
        setError(msg);
      }
    } finally {
      setSending(false);
      abortRef.current = null;
      currentAssistantIdRef.current = null;
      thinkingStartedAtRef.current = null;
    }
  }, [currentSessionId, sending, router, createSession, loadSession, refreshSessions]);

  // ── Stop generation ────────────────────────────────────────────────────────
  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setSending(false);
  }, []);

  // ── Regenerate last assistant message ──────────────────────────────────────
  const handleRegenerate = useCallback(() => {
    if (sending || messages.length < 2) return;
    let lastUserContent = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserContent = messages[i].content;
        break;
      }
    }
    if (!lastUserContent) return;
    setMessages(prev => {
      const next = [...prev];
      while (next.length && next[next.length - 1].role === 'assistant') next.pop();
      return next;
    });
    setTimeout(() => {
      sendMessage({
        content: lastUserContent,
        planMode: planModeRef.current,
        modelMode: modelModeRef.current,
      });
    }, 50);
  }, [sending, messages, sendMessage]);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loadingData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading chat…</p>
        </div>
      </div>
    );
  }

  const selectedModel = models.find(m => m.id === modelMode.modelId);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <TooltipProvider delayDuration={200}>
      <div className="h-screen w-full flex bg-background overflow-hidden">
        {/* Sidebar */}
        <ChatSidebar
          sessions={sessions}
          currentSessionId={currentSessionId}
          loading={sending}
          onCreateSession={handleNewChat}
          onSelectSession={loadSession}
          onDeleteSession={deleteSession}
          mobileOpen={mobileSidebarOpen}
          onMobileOpenChange={setMobileSidebarOpen}
        />

        {/* Main chat column */}
        <main className="flex-1 flex flex-col min-w-0 bg-gradient-to-b from-background to-slate-50/50 dark:to-slate-950/30">
          {/* Header */}
          <header className="flex-shrink-0 border-b bg-background/80 backdrop-blur-sm">
            <div className="flex items-center gap-2 px-3 sm:px-4 py-2.5">
              {/* Mobile sidebar trigger */}
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden flex-shrink-0"
                onClick={() => setMobileSidebarOpen(true)}
                aria-label="Open sessions"
              >
                <Menu className="w-4 h-4" />
              </Button>

              {/* Universal agent badge */}
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                <Sparkles className="w-3.5 h-3.5" />
                <span className="text-[12px] font-medium">{UNIVERSAL_AGENT_NAME}</span>
                <span className="text-[10px] uppercase opacity-70 hidden sm:inline">universal</span>
              </div>

              {/* Active mode indicators */}
              <div className="hidden sm:flex items-center gap-1.5 ml-1">
                {planMode && (
                  <span className="inline-flex items-center gap-1 text-[10.5px] font-medium px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    <Lightbulb className="w-2.5 h-2.5" />
                    Plan
                  </span>
                )}
                {selectedModel && modelMode.thinkingEnabled && selectedModel.supportsThinking && (
                  <span className="inline-flex items-center gap-1 text-[10.5px] font-medium px-1.5 py-0.5 rounded-md bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300">
                    <Brain className="w-2.5 h-2.5" />
                    Thinking
                  </span>
                )}
                {selectedModel && (
                  <span className="inline-flex items-center gap-1 text-[10.5px] font-medium px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                    <Cpu className="w-2.5 h-2.5" />
                    {selectedModel.displayName || selectedModel.name}
                  </span>
                )}
              </div>

              <div className="flex-1" />

              {/* Session stats (desktop) */}
              {currentSessionMeta && (
                <div className="hidden sm:flex items-center gap-3 text-[11px] text-muted-foreground">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-1">
                        <Activity className="w-3 h-3" />
                        <span className="font-mono">{currentSessionMeta.messageCount || messages.length} msgs</span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Messages in session</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-1">
                        <Cpu className="w-3 h-3" />
                        <span className="font-mono">{formatTokens(currentSessionMeta.totalTokens || 0)}</span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Total tokens used</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-1">
                        <Coins className="w-3 h-3" />
                        <span className="font-mono">{formatTotalCost(currentSessionMeta.totalCost)}</span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Total cost</TooltipContent>
                  </Tooltip>
                </div>
              )}

              {/* Regenerate button */}
              {messages.length > 0 && !sending && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={handleRegenerate}
                      aria-label="Regenerate last response"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Regenerate last response</TooltipContent>
                </Tooltip>
              )}

              {/* Clear session button */}
              {currentSessionId && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-rose-500"
                      onClick={() => deleteSession(currentSessionId)}
                      aria-label="Delete session"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Delete session</TooltipContent>
                </Tooltip>
              )}
            </div>

            {/* Error banner */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-3 sm:px-4 py-1.5 bg-rose-50 dark:bg-rose-950/30 border-t border-rose-200 dark:border-rose-900 flex items-center gap-2 text-[11px] text-rose-700 dark:text-rose-300">
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{error}</span>
                    <button
                      onClick={() => setError(null)}
                      className="ml-auto text-rose-500 hover:text-rose-700"
                      aria-label="Dismiss error"
                    >
                      ×
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </header>

          {/* Messages scroll area */}
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto scroll-smooth"
            style={{ scrollBehavior: 'smooth' }}
          >
            {!currentSessionId ? (
              <EmptyChatState
                onSuggest={(s) => {
                  setInput(s);
                }}
              />
            ) : messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-6">
                <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-3">
                  <Sparkles className="w-7 h-7 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium mb-1">Empty conversation</p>
                <p className="text-xs text-muted-foreground">Send a message to begin</p>
              </div>
            ) : (
              <div className="max-w-3xl mx-auto px-3 sm:px-6 py-4">
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
                <div ref={messagesEndRef} className="h-1" />
              </div>
            )}
          </div>

          {/* Input area — always visible so the user can start a new chat */}
          <footer className="flex-shrink-0 border-t bg-background/80 backdrop-blur-sm">
            <div className="max-w-3xl mx-auto px-3 sm:px-6 py-3">
              <ChatInput
                value={input}
                onChange={setInput}
                onSend={(opts) => sendMessage(opts)}
                onStop={handleStop}
                sending={sending}
                models={models}
                modelMode={modelMode}
                onModelModeChange={setModelMode}
                planMode={planMode}
                onPlanModeChange={setPlanMode}
                placeholder="Message the agent…  (Enter to send, Shift+Enter for newline)"
              />
            </div>
          </footer>
        </main>
      </div>
    </TooltipProvider>
  );
}
