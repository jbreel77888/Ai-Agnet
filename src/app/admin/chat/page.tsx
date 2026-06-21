'use client';

/**
 * Manus-style Chat Page
 * ──────────────────────
 * Full chat experience:
 *   - Dark sidebar with sessions + agent picker
 *   - Streaming SSE messages with thinking process, tool calls, artifacts
 *   - Stop / regenerate, copy message, auto-scroll
 *   - Markdown rendering with syntax highlighting
 *   - Mobile-responsive (sidebar collapses to sheet)
 *
 * Backend endpoints (already implemented):
 *   GET    /api/agents
 *   GET    /api/sessions
 *   POST   /api/sessions
 *   GET    /api/sessions/[id]
 *   DELETE /api/sessions/[id]
 *   POST   /api/sessions/[id]/messages   (SSE)
 */
import {
  useState, useEffect, useRef, useCallback, useMemo, type KeyboardEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  Send, Square, Bot, Sparkles, AlertTriangle, Trash2,
  RefreshCw, Menu, Activity, Cpu, Coins, Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ChatSidebar,
  type SidebarAgent,
  type SidebarSession,
} from '@/components/chat/ChatSidebar';
import {
  MessageBubble,
  type ChatMessageData,
} from '@/components/chat/MessageBubble';
import type { ThinkingStep } from '@/components/chat/ThinkingProcess';
import type { ToolCallData } from '@/components/chat/ToolCallCard';
import { getAgentTypeStyle } from '@/lib/agent-types';

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

interface ApiAgent {
  id: string; name: string; slug: string; type: string;
  description?: string | null;
  systemPrompt?: string;
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
let stepCounter = 0;
function newStepId(): string {
  stepCounter += 1;
  return `step-${Date.now()}-${stepCounter}`;
}

/** Convert an API message (loaded from DB) to our ChatMessageData shape. */
function apiMessageToChatMessage(
  m: ApiMessage,
  agentType?: string,
  agentName?: string,
): ChatMessageData {
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
    agentType,
    agentName,
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

// ─────────────────────────────────────────────────────────────────────────────
// Empty state component
// ─────────────────────────────────────────────────────────────────────────────
function EmptyChatState({ onSuggest, agentName }: { onSuggest: (s: string) => void; agentName?: string }) {
  const suggestions = [
    'Explain how AI agents work',
    'Write a Python function to fetch and parse JSON',
    'Research the latest news about LLMs',
    'Help me plan a 3-day trip to Tokyo',
  ];
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 py-12">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-lg mb-4">
        <Sparkles className="w-8 h-8" />
      </div>
      <h2 className="text-xl font-bold mb-1">
        {agentName ? `Chat with ${agentName}` : 'Start a new conversation'}
      </h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-md">
        Send a message and watch the agent think, use tools, and produce artifacts in real time.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-xl">
        {suggestions.map(s => (
          <button
            key={s}
            onClick={() => onSuggest(s)}
            className="text-left px-4 py-3 rounded-lg border bg-card hover:bg-accent hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors text-[13px] text-foreground/80 hover:text-foreground"
          >
            {s}
          </button>
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
  const [agents, setAgents] = useState<SidebarAgent[]>([]);
  const [sessions, setSessions] = useState<SidebarSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentSessionMeta, setCurrentSessionMeta] = useState<ApiSession | null>(null);
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [input, setInput] = useState('');
  const [loadingData, setLoadingData] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const abortRef = useRef<AbortController | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const currentAssistantIdRef = useRef<string | null>(null);
  const sessionMetaRef = useRef<ApiSession | null>(null);
  sessionMetaRef.current = currentSessionMeta;

  // ── Auth check + initial data ──────────────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/login'); return; }
    Promise.all([
      fetch('/api/agents', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      fetch('/api/sessions', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    ]).then(([agentsData, sessionsData]) => {
      if (agentsData.success) {
        const mapped: SidebarAgent[] = (agentsData.data.agents || []).map((a: ApiAgent) => ({
          id: a.id, name: a.name, slug: a.slug, type: a.type, description: a.description,
        }));
        setAgents(mapped);
        if (mapped.length > 0) {
          // Use functional update so we don't need `selectedAgent` in deps
          setSelectedAgent(prev => prev || mapped[0].slug);
        }
      }
      if (sessionsData.success) {
        const mapped: SidebarSession[] = (sessionsData.data.sessions || []).map((s: ApiSession) => ({
          id: s.id,
          agentName: s.agentName,
          agentSlug: s.agentSlug,
          title: s.title || 'Untitled',
          status: s.status,
          lastActivityAt: s.lastActivityAt,
          messageCount: s.messageCount,
          totalTokens: s.totalTokens,
        }));
        setSessions(mapped);
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
    const threshold = 80; // px from bottom
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    autoScrollRef.current = distanceFromBottom < threshold;
  }, []);

  // ── Auto-grow textarea ─────────────────────────────────────────────────────
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }, [input]);

  // ── Helper: refresh sessions list ──────────────────────────────────────────
  const refreshSessions = useCallback(async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) return;
    try {
      const res = await fetch('/api/sessions', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.success) {
        const mapped: SidebarSession[] = (data.data.sessions || []).map((s: ApiSession) => ({
          id: s.id,
          agentName: s.agentName,
          agentSlug: s.agentSlug,
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
        // Find agent type for color coding
        const agent = agents.find(a => a.id === session.agentId);
        const agentType = agent?.type;
        const agentName = agent?.name || session.agentName;
        const mapped: ChatMessageData[] = apiMsgs.map(m =>
          apiMessageToChatMessage(m, agentType, agentName)
        );
        setCurrentSessionId(sessionId);
        setCurrentSessionMeta(session);
        setMessages(mapped);
        autoScrollRef.current = true;
        // Wait a tick then scroll
        setTimeout(() => scrollToBottom(false), 50);
      } else if (res.status === 401) {
        router.push('/login');
      } else {
        setError(data.error?.message || 'Failed to load session');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load session');
    }
  }, [agents, router, scrollToBottom]);

  // ── Create session ────────────────────────────────────────────────────────
  const createSession = useCallback(async () => {
    const token = localStorage.getItem('accessToken');
    if (!token || !selectedAgent || selectedAgent === '_none') return;
    setError(null);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ agentSlug: selectedAgent }),
      });
      const data = await res.json();
      if (data.success) {
        await refreshSessions();
        await loadSession(data.data.sessionId);
      } else {
        setError(data.error?.message || 'Failed to create session');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create session');
    }
  }, [selectedAgent, refreshSessions, loadSession]);

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
  const sendMessage = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || !currentSessionId || sending) return;

    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/login'); return; }

    setError(null);
    setInput('');
    autoScrollRef.current = true;

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
    const session = sessionMetaRef.current;
    const agent = agents.find(a => a.id === session?.agentId);
    const agentType = agent?.type;
    const agentName = agent?.name || session?.agentName;

    const assistantMsg: ChatMessageData = {
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
      agentType,
      agentName,
      isStreaming: true,
      thinkingSteps: [{
        id: newStepId(),
        kind: 'analyzing',
        label: 'Analyzing request',
        status: 'running',
        ts: Date.now(),
      }],
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
      const res = await fetch(`/api/sessions/${currentSessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content }),
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
      let accumulatedContent = '';
      let startedAt = Date.now();

      const finishRunningSteps = (steps: ThinkingStep[]): ThinkingStep[] =>
        steps.map(s => s.status === 'running' ? { ...s, status: 'completed' as const } : s);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE messages are separated by double newlines; lines start with "data: "
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // keep last partial line

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
              startedAt = Date.now();
              updateAssistant(m => ({
                ...m,
                thinkingSteps: m.thinkingSteps?.map(s =>
                  s.kind === 'analyzing' && s.status === 'running'
                    ? { ...s, status: 'running', label: 'Analyzing request' }
                    : s
                ) ?? [],
              }));
              break;
            }
            case 'thinking': {
              updateAssistant(m => ({
                ...m,
                thinkingSteps: [
                  ...(m.thinkingSteps ?? []),
                  {
                    id: newStepId(),
                    kind: 'info',
                    label: 'Thinking',
                    detail: event.content.slice(0, 100),
                    status: 'completed',
                    ts: Date.now(),
                  },
                ],
              }));
              break;
            }
            case 'message_chunk': {
              accumulatedContent += event.content;
              updateAssistant(m => {
                let steps = m.thinkingSteps ?? [];
                // Complete any 'analyzing' step, ensure a 'synthesizing' step exists
                steps = steps.map(s => s.status === 'running' && s.kind === 'analyzing'
                  ? { ...s, status: 'completed' as const, durationMs: Date.now() - startedAt }
                  : s
                );
                if (!steps.some(s => s.kind === 'synthesizing')) {
                  steps = [...steps, {
                    id: newStepId(), kind: 'synthesizing',
                    label: 'Synthesizing response',
                    status: 'running', ts: Date.now(),
                  }];
                }
                return { ...m, content: accumulatedContent, thinkingSteps: steps };
              });
              break;
            }
            case 'tool_call': {
              updateAssistant(m => {
                let steps = m.thinkingSteps ?? [];
                // Complete any running 'synthesizing' step
                steps = steps.map(s => s.status === 'running' && s.kind === 'synthesizing'
                  ? { ...s, status: 'completed' as const }
                  : s
                );
                // Add a 'tool' thinking step
                steps = [...steps, {
                  id: newStepId(),
                  kind: 'tool',
                  label: `Running ${event.toolName}`,
                  status: 'running',
                  ts: Date.now(),
                }];
                // Add tool call card (running)
                const newTool: ToolCallData = {
                  id: event.toolCallId || `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  toolName: event.toolName,
                  args: event.args,
                  status: 'running',
                };
                return {
                  ...m,
                  thinkingSteps: steps,
                  toolCalls: [...(m.toolCalls ?? []), newTool],
                };
              });
              break;
            }
            case 'tool_result': {
              updateAssistant(m => {
                let steps = m.thinkingSteps ?? [];
                // Complete the matching 'tool' step
                steps = steps.map(s => {
                  if (s.status === 'running' && s.kind === 'tool' &&
                      s.label === `Running ${event.toolName}`) {
                    return { ...s, status: 'completed' as const, durationMs: event.durationMs };
                  }
                  return s;
                });
                // Re-open 'synthesizing' step if none running
                if (!steps.some(s => s.status === 'running' && s.kind === 'synthesizing')) {
                  steps = [...steps, {
                    id: newStepId(), kind: 'synthesizing',
                    label: 'Synthesizing response',
                    status: 'running', ts: Date.now(),
                  }];
                }
                // Update matching tool call with result
                const toolCalls = (m.toolCalls ?? []).map(tc => {
                  // Match by name AND status running (the most recent matching one)
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
                return { ...m, thinkingSteps: steps, toolCalls };
              });
              break;
            }
            case 'handoff_request': {
              updateAssistant(m => ({
                ...m,
                thinkingSteps: [
                  ...(m.thinkingSteps ?? []),
                  {
                    id: newStepId(), kind: 'info',
                    label: `Handing off to ${event.target}`,
                    detail: event.reason,
                    status: 'completed', ts: Date.now(),
                  },
                ],
              }));
              break;
            }
            case 'subagent_spawned': {
              updateAssistant(m => ({
                ...m,
                thinkingSteps: [
                  ...(m.thinkingSteps ?? []),
                  {
                    id: newStepId(), kind: 'analyzing',
                    label: `Spawned ${event.agentType} subagent`,
                    status: 'completed', ts: Date.now(),
                  },
                ],
              }));
              break;
            }
            case 'completed': {
              const totalDuration = Date.now() - startedAt;
              updateAssistant(m => ({
                ...m,
                isStreaming: false,
                content: m.content || event.output?.content || accumulatedContent,
                thinkingSteps: finishRunningSteps(m.thinkingSteps ?? []),
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
                isError: true,
                content: m.content
                  ? m.content + `\n\n⚠️ **Error:** ${errMsg}`
                  : `⚠️ **Error:** ${errMsg}`,
                thinkingSteps: m.thinkingSteps?.map(s =>
                  s.status === 'running'
                    ? { ...s, status: 'failed' as const }
                    : s
                ) ?? [],
              }));
              setError(errMsg);
              break;
            }
            case 'cancelled': {
              updateAssistant(m => ({
                ...m,
                isStreaming: false,
                content: m.content + '\n\n_(cancelled)_',
                thinkingSteps: m.thinkingSteps?.map(s =>
                  s.status === 'running'
                    ? { ...s, status: 'failed' as const, detail: 'cancelled' }
                    : s
                ) ?? [],
              }));
              break;
            }
            case 'message_saved': {
              // Replace temp id with real DB id
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, id: event.messageId } : m
              ));
              currentAssistantIdRef.current = event.messageId;
              // Refresh sessions to update lastActivityAt + counts
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
          content: (m.content || '') + '\n\n_(stopped by user)_',
          thinkingSteps: m.thinkingSteps?.map(s =>
            s.status === 'running'
              ? { ...s, status: 'failed' as const, detail: 'stopped' }
              : s
          ) ?? [],
        }));
      } else {
        const msg = err.message || 'Network error';
        updateAssistant(m => ({
          ...m,
          isStreaming: false,
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
    }
  }, [input, currentSessionId, sending, agents, router, refreshSessions]);

  // ── Stop generation ────────────────────────────────────────────────────────
  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setSending(false);
  }, []);

  // ── Regenerate last assistant message ──────────────────────────────────────
  const handleRegenerate = useCallback(() => {
    if (sending || messages.length < 2) return;
    // Find last user message
    let lastUserContent = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserContent = messages[i].content;
        break;
      }
    }
    if (!lastUserContent) return;
    // Remove last assistant message
    setMessages(prev => {
      const next = [...prev];
      // remove trailing assistant messages
      while (next.length && next[next.length - 1].role === 'assistant') next.pop();
      return next;
    });
    // Re-send
    setTimeout(() => sendMessage(lastUserContent), 50);
  }, [sending, messages, sendMessage]);

  // ── Textarea key handler ───────────────────────────────────────────────────
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Derived data ───────────────────────────────────────────────────────────
  const currentAgent = useMemo(
    () => agents.find(a => a.id === currentSessionMeta?.agentId),
    [agents, currentSessionMeta],
  );

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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <TooltipProvider delayDuration={200}>
      <div className="h-screen w-full flex bg-background overflow-hidden">
        {/* Sidebar (desktop static + mobile sheet) */}
        <ChatSidebar
          agents={agents}
          sessions={sessions}
          selectedAgent={selectedAgent}
          currentSessionId={currentSessionId}
          loading={sending}
          onSelectAgent={setSelectedAgent}
          onCreateSession={createSession}
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

              {/* Agent badge */}
              {currentAgent ? (
                <div className={`flex items-center gap-2 px-2.5 py-1 rounded-full ${getAgentTypeStyle(currentAgent.type).softBg} ${getAgentTypeStyle(currentAgent.type).softText}`}>
                  {(() => {
                    const Icon = getAgentTypeStyle(currentAgent.type).icon;
                    return <Icon className="w-3.5 h-3.5" />;
                  })()}
                  <span className="text-[12px] font-medium">{currentAgent.name}</span>
                  <span className="text-[10px] uppercase opacity-70">{currentAgent.type}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Bot className="w-4 h-4" />
                  <span>Agent Chat</span>
                </div>
              )}

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
            {error && (
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
            )}
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
                agentName={currentAgent?.name}
                onSuggest={(s) => {
                  // Auto-create a session with the selected agent, then send
                  if (!selectedAgent || selectedAgent === '_none') return;
                  createSession().then(() => {
                    // Wait briefly for the session to load, then send
                    setTimeout(() => sendMessage(s), 400);
                  });
                }}
              />
            ) : messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-6">
                <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-3">
                  <Bot className="w-7 h-7 text-muted-foreground" />
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

          {/* Input area */}
          {currentSessionId && (
            <footer className="flex-shrink-0 border-t bg-background/80 backdrop-blur-sm">
              <div className="max-w-3xl mx-auto px-3 sm:px-6 py-3">
                <div className="relative flex items-end gap-2 rounded-xl border bg-card focus-within:ring-2 focus-within:ring-emerald-500/30 transition-shadow">
                  <Textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder={`Message ${currentAgent?.name || 'agent'}…  (Enter to send, Shift+Enter for newline)`}
                    disabled={sending}
                    rows={1}
                    className="flex-1 min-h-[44px] max-h-40 resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-[14px] py-3 px-3.5"
                  />
                  {sending ? (
                    <Button
                      onClick={handleStop}
                      variant="destructive"
                      size="icon"
                      className="m-1.5 flex-shrink-0 rounded-lg"
                      aria-label="Stop generation"
                    >
                      <Square className="w-4 h-4" fill="currentColor" />
                    </Button>
                  ) : (
                    <Button
                      onClick={() => sendMessage()}
                      disabled={!input.trim()}
                      size="icon"
                      className="m-1.5 flex-shrink-0 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700"
                      aria-label="Send message"
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                <div className="flex items-center justify-between mt-1.5 px-1 text-[10px] text-muted-foreground/70">
                  <span className="hidden sm:inline">
                    {currentAgent ? `Agent: ${currentAgent.name}` : ''}
                  </span>
                  <span className="ml-auto flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    Responses stream in real-time
                  </span>
                </div>
              </div>
            </footer>
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}
