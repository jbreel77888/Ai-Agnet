'use client';

/**
 * WorkspacePanel — Manus / z.ai-style "Workspace" side panel.
 *
 * Aggregates everything related to the active session in one place:
 *
 *   ┌─ Workspace ────────────────────────────────────┐
 *   │  [Files] [Artifacts] [Tools] [Activity] [Env]   │
 *   │ ─────────────────────────────────────────────── │
 *   │  Tab content (scrollable)                       │
 *   └─────────────────────────────────────────────────┘
 *
 * Tabs:
 *   Files      → session-scoped file uploads (list + upload + delete + preview)
 *   Artifacts  → DB artifacts for this session (from `artifacts` table)
 *   Tools      → tool-call history (status, args, result, duration)
 *   Activity   → recent messages (role, preview, tokens, cost, latency)
 *   Env        → agent + model + provider + runtime + sandbox + integrations
 *
 * Data source: GET /api/sessions/[id]/workspace
 * Uploads:    POST /api/sessions/[id]/files   (multipart/form-data)
 * Delete:     DELETE /api/sessions/[id]/files?key=...
 *
 * The panel auto-refreshes on a 5-second interval while visible.
 */
import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Files as FilesIcon, FileText, FileCode, FileJson, Image as ImageIcon,
  Upload, Trash2, Download, Eye, X, RefreshCw, Loader2, CheckCircle2,
  AlertCircle, Clock, Cpu, Server, Box, Wrench, Globe, Brain, Github,
  Slack, Mail, StickyNote, ChevronRight, Terminal, Activity, Zap,
  CircleDashed, CircleDot, type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Types — workspace payload shape (matches API response)
// ─────────────────────────────────────────────────────────────────────────────
export interface WorkspaceFile {
  key: string;
  name: string;
  contentType?: string;
  sizeBytes: number;
  isPublic?: boolean;
  createdAt: string;
  originalName?: string;
  source?: string;
}

export interface WorkspaceArtifact {
  id: string;
  name: string;
  type: string;
  storageKey: string;
  mimeType?: string;
  sizeBytes: number;
  createdAt: string;
  metadata?: any;
}

export interface WorkspaceToolCall {
  id: string;
  toolName: string;
  arguments?: any;
  result?: any;
  status: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
  durationMs: number;
}

export interface WorkspaceMessage {
  id: string;
  role: string;
  preview: string;
  tokensInput: number;
  tokensOutput: number;
  cost: string;
  latencyMs: number;
  createdAt: string;
  finishReason?: string;
  toolCallCount: number;
}

export interface WorkspaceEnvironment {
  agent: {
    id: string; name: string; slug: string; type: string;
    description?: string; temperature: string; maxTokens: number;
    topP: string; systemPrompt?: string;
  } | null;
  model: {
    id: string; name: string; displayName?: string;
    contextWindow: number; maxOutputTokens: number;
    supportsTools: boolean; supportsVision: boolean;
    supportsStreaming: boolean; supportsThinking: boolean;
    supportsJsonMode: boolean;
    status: string; inputPricePer1k: string; outputPricePer1k: string;
  } | null;
  provider: {
    id: string; name: string; slug: string; type: string;
    baseUrl: string; status: string; healthStatus: string;
  } | null;
}

export interface WorkspaceSandbox {
  runtime: {
    nodeVersion: string; platform: string; arch: string;
    pid: number; uptime: number;
  };
  storage: {
    driver: string; basePath: string; filesCount: number;
  };
  session: {
    id: string; status: string; startedAt: string;
    lastActivityAt: string; totalTokens: number;
    totalCost: string; messageCount: number;
  };
  environment: Record<string, boolean>;
  sandbox: {
    type: string; isolated: boolean;
    networkAccess: boolean; filesystemAccess: string;
  };
  integrations: {
    github: boolean; slack: boolean; notion: boolean; email: boolean;
  };
}

export interface WorkspaceData {
  sessionId: string;
  session: {
    id: string; title: string; status: string;
    startedAt: string; lastActivityAt: string;
    totalTokens: number; totalCost: string;
    agentSlug: string; agentName: string;
  };
  files: WorkspaceFile[];
  artifacts: WorkspaceArtifact[];
  toolCalls: WorkspaceToolCall[];
  messages: WorkspaceMessage[];
  environment: WorkspaceEnvironment;
  sandbox: WorkspaceSandbox;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(extra || {}) };
}

function formatBytes(n: number): string {
  if (n === 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatRelativeTime(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

function fileIcon(contentType?: string): LucideIcon {
  if (!contentType) return FileText;
  if (contentType.startsWith('image/')) return ImageIcon;
  if (contentType.includes('json')) return FileJson;
  if (contentType.includes('javascript') || contentType.includes('typescript') || contentType.includes('text/x-')) return FileCode;
  if (contentType.startsWith('text/')) return FileText;
  return FileText;
}

function safeJsonStringify(v: unknown, max = 200): string {
  if (v === undefined || v === null) return '';
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  } catch { return String(v); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Small UI atoms
// ─────────────────────────────────────────────────────────────────────────────
function EmptyState({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="w-10 h-10 rounded-lg bg-muted/50 flex items-center justify-center mb-2">
        <Icon className="w-5 h-5 text-muted-foreground" />
      </div>
      <p className="text-[12.5px] font-medium text-foreground/80">{title}</p>
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

function StatPill({ icon: Icon, label, value, color = 'text-muted-foreground' }: {
  icon: LucideIcon; label: string; value: ReactNode; color?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-muted/40">
      <Icon className={cn('w-3 h-3', color)} />
      <div className="flex flex-col">
        <span className="text-[9.5px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="text-[11.5px] font-mono font-medium">{value}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Files tab
// ─────────────────────────────────────────────────────────────────────────────
function FilesTab({
  sessionId, files, onRefresh,
}: {
  sessionId: string;
  files: WorkspaceFile[];
  onRefresh: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState<WorkspaceFile | null>(null);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleUpload = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      const fd = new FormData();
      Array.from(fileList).forEach(f => fd.append('files', f));
      const res = await fetch(`/api/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: authHeaders(),
        body: fd,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.message || `HTTP ${res.status}`);
      }
      onRefresh();
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }, [sessionId, onRefresh]);

  const handleDelete = useCallback(async (key: string) => {
    if (!confirm('Delete this file?')) return;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/files?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.message || `HTTP ${res.status}`);
      }
      onRefresh();
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    }
  }, [sessionId, onRefresh]);

  const handlePreview = useCallback(async (file: WorkspaceFile) => {
    setPreviewFile(file);
    setPreviewContent('');
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/storage/${encodeURIComponent(file.key)}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const ct = file.contentType || 'text/plain';
      if (ct.startsWith('image/')) {
        const blob = new Blob([buf], { type: ct });
        setPreviewContent(URL.createObjectURL(blob));
      } else if (ct.includes('json') || ct.startsWith('text/')) {
        setPreviewContent(new TextDecoder().decode(buf));
      } else {
        setPreviewContent(`(binary file, ${formatBytes(buf.byteLength)} — preview not available)`);
      }
    } catch (err: any) {
      setPreviewContent(`Failed to load: ${err.message}`);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const handleDownload = useCallback(async (file: WorkspaceFile) => {
    try {
      const res = await fetch(`/api/storage/${encodeURIComponent(file.key)}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const blob = new Blob([buf], { type: file.contentType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = file.originalName || file.name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err: any) {
      alert('Download failed: ' + err.message);
    }
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Upload area */}
      <div className="p-2.5 border-b border-slate-200/60 dark:border-slate-800/60">
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleUpload(e.target.files)}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full h-8 gap-1.5 text-[12px] border-dashed"
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {uploading ? 'Uploading…' : 'Upload Files'}
        </Button>
      </div>

      {/* Files list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1">
          {files.length === 0 ? (
            <EmptyState icon={FilesIcon} title="No files yet" hint="Upload files for the agent to use" />
          ) : (
            files.map(f => {
              const Icon = fileIcon(f.contentType);
              return (
                <motion.div
                  key={f.key}
                  layout
                  initial={{ opacity: 0, y: -2 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="group flex items-center gap-2 px-2.5 py-2 rounded-md border border-slate-200/60 dark:border-slate-800/60 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-muted/30 transition-colors"
                >
                  <div className="w-7 h-7 rounded-md bg-muted/60 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium truncate">{f.originalName || f.name}</p>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="font-mono">{formatBytes(f.sizeBytes)}</span>
                      {f.contentType && (
                        <>
                          <span>·</span>
                          <span className="truncate">{f.contentType}</span>
                        </>
                      )}
                      <span>·</span>
                      <span>{formatRelativeTime(f.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => handlePreview(f)}
                          className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                          aria-label="Preview"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Preview</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => handleDownload(f)}
                          className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                          aria-label="Download"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Download</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => handleDelete(f.key)}
                          className="p-1.5 rounded hover:bg-rose-100 dark:hover:bg-rose-950/40 text-muted-foreground hover:text-rose-500"
                          aria-label="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Delete</TooltipContent>
                    </Tooltip>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Preview modal */}
      <AnimatePresence>
        {previewFile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setPreviewFile(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-background rounded-lg border shadow-xl max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col"
            >
              <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-muted/40">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <span className="text-[12.5px] font-medium truncate flex-1">{previewFile.originalName || previewFile.name}</span>
                <Badge variant="outline" className="text-[10px] h-5">{formatBytes(previewFile.sizeBytes)}</Badge>
                <button
                  onClick={() => setPreviewFile(null)}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-auto">
                {previewLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : previewFile.contentType?.startsWith('image/') ? (
                  <div className="flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-950">
                    <img src={previewContent} alt={previewFile.name} className="max-w-full max-h-[60vh] rounded" />
                  </div>
                ) : (
                  <pre className="m-0 p-3 text-[12px] font-mono whitespace-pre-wrap break-words">{previewContent}</pre>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Artifacts tab
// ─────────────────────────────────────────────────────────────────────────────
function ArtifactsTab({ artifacts }: { artifacts: WorkspaceArtifact[] }) {
  if (artifacts.length === 0) {
    return <EmptyState icon={Box} title="No artifacts" hint="Outputs produced by the agent will appear here" />;
  }
  return (
    <ScrollArea className="h-full">
      <div className="p-2 space-y-1.5">
        {artifacts.map(a => (
          <motion.div
            key={a.id}
            layout
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            className="px-2.5 py-2 rounded-md border border-slate-200/60 dark:border-slate-800/60 bg-muted/20"
          >
            <div className="flex items-center gap-2 mb-1">
              <FileCode className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
              <span className="text-[12px] font-medium truncate flex-1">{a.name}</span>
              <Badge variant="outline" className="text-[9.5px] h-4 px-1.5 uppercase">{a.type}</Badge>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              {a.mimeType && <span className="truncate">{a.mimeType}</span>}
              <span>·</span>
              <span className="font-mono">{formatBytes(a.sizeBytes)}</span>
              <span>·</span>
              <span>{formatRelativeTime(a.createdAt)}</span>
            </div>
            {a.storageKey && (
              <p className="text-[10px] font-mono text-muted-foreground/70 mt-1 truncate">{a.storageKey}</p>
            )}
          </motion.div>
        ))}
      </div>
    </ScrollArea>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool calls tab
// ─────────────────────────────────────────────────────────────────────────────
function ToolStatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; icon: LucideIcon }> = {
    success: { color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300', icon: CheckCircle2 },
    failed: { color: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300', icon: AlertCircle },
    running: { color: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300', icon: Loader2 },
    pending: { color: 'bg-muted text-muted-foreground', icon: Clock },
    timeout: { color: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300', icon: Clock },
  };
  const { color, icon: Icon } = map[status] || map.pending;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded', color)}>
      <Icon className={cn('w-2.5 h-2.5', status === 'running' && 'animate-spin')} />
      {status}
    </span>
  );
}

const TOOL_ICONS: Record<string, LucideIcon> = {
  web_search: Globe,
  http_request: Globe,
  browser: Globe,
  calculator: Cpu,
  code_execution: Terminal,
  memory_search: Brain,
  memory_store: Box,
  github: Github,
};

function ToolsTab({ toolCalls }: { toolCalls: WorkspaceToolCall[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (toolCalls.length === 0) {
    return <EmptyState icon={Wrench} title="No tool calls yet" hint="Tool invocations will appear here as the agent works" />;
  }
  return (
    <ScrollArea className="h-full">
      <div className="p-2 space-y-1">
        {toolCalls.map(tc => {
          const Icon = TOOL_ICONS[tc.toolName] || Wrench;
          const isExpanded = expanded === tc.id;
          return (
            <div key={tc.id} className="rounded-md border border-slate-200/60 dark:border-slate-800/60 overflow-hidden">
              <button
                onClick={() => setExpanded(isExpanded ? null : tc.id)}
                className="w-full flex items-center gap-2 px-2.5 py-2 hover:bg-muted/30 transition-colors text-left"
              >
                <div className="w-7 h-7 rounded-md bg-muted/60 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium truncate">{tc.toolName}</p>
                  <p className="text-[10px] text-muted-foreground">{formatRelativeTime(tc.startedAt)}</p>
                </div>
                <ToolStatusBadge status={tc.status} />
                {tc.durationMs > 0 && (
                  <span className="text-[10px] text-muted-foreground/70 font-mono">{formatDuration(tc.durationMs)}</span>
                )}
                <ChevronRight className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform', isExpanded && 'rotate-90')} />
              </button>
              <AnimatePresence initial={false}>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden border-t border-slate-200/60 dark:border-slate-800/60"
                  >
                    <div className="px-3 py-2 space-y-2 bg-muted/20">
                      {tc.arguments !== undefined && tc.arguments !== null && (
                        <div>
                          <p className="text-[9.5px] uppercase tracking-wide text-muted-foreground/70 mb-1">Arguments</p>
                          <pre className="text-[10.5px] font-mono whitespace-pre-wrap break-words bg-slate-50 dark:bg-slate-900/60 rounded p-1.5 max-h-32 overflow-auto">
                            {safeJsonStringify(tc.arguments, 600)}
                          </pre>
                        </div>
                      )}
                      {tc.result !== undefined && tc.result !== null && (
                        <div>
                          <p className="text-[9.5px] uppercase tracking-wide text-muted-foreground/70 mb-1">Result</p>
                          <pre className="text-[10.5px] font-mono whitespace-pre-wrap break-words bg-slate-50 dark:bg-slate-900/60 rounded p-1.5 max-h-40 overflow-auto">
                            {safeJsonStringify(tc.result, 800)}
                          </pre>
                        </div>
                      )}
                      {tc.error && (
                        <div>
                          <p className="text-[9.5px] uppercase tracking-wide text-rose-500/70 mb-1">Error</p>
                          <pre className="text-[10.5px] font-mono whitespace-pre-wrap break-words text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 rounded p-1.5">
                            {tc.error}
                          </pre>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity tab — recent messages
// ─────────────────────────────────────────────────────────────────────────────
function ActivityTab({ messages }: { messages: WorkspaceMessage[] }) {
  if (messages.length === 0) {
    return <EmptyState icon={Activity} title="No activity yet" />;
  }
  return (
    <ScrollArea className="h-full">
      <div className="p-2 space-y-1">
        {messages.map(m => {
          const isUser = m.role === 'user';
          const isAssistant = m.role === 'assistant';
          const tokens = m.tokensInput + m.tokensOutput;
          return (
            <div
              key={m.id}
              className={cn(
                'px-2.5 py-2 rounded-md border text-[12px]',
                isUser
                  ? 'border-emerald-200/60 dark:border-emerald-900/40 bg-emerald-50/40 dark:bg-emerald-950/10'
                  : isAssistant
                    ? 'border-slate-200/60 dark:border-slate-800/60 bg-muted/20'
                    : 'border-slate-200/60 dark:border-slate-800/60 bg-muted/10'
              )}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Badge variant="outline" className="text-[9.5px] h-4 px-1.5 uppercase">{m.role}</Badge>
                <span className="text-[10px] text-muted-foreground ml-auto">{formatRelativeTime(m.createdAt)}</span>
              </div>
              <p className="text-[11.5px] text-foreground/80 line-clamp-2 whitespace-pre-wrap break-words">{m.preview || '(empty)'}</p>
              <div className="flex items-center gap-1.5 mt-1 text-[9.5px] text-muted-foreground">
                {tokens > 0 && <span className="font-mono">{tokens} tok</span>}
                {m.cost && parseFloat(m.cost) > 0 && <span className="font-mono">${parseFloat(m.cost).toFixed(5)}</span>}
                {m.latencyMs > 0 && <span className="font-mono">{formatDuration(m.latencyMs)}</span>}
                {m.toolCallCount > 0 && <span>· {m.toolCallCount} tool calls</span>}
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Environment tab
// ─────────────────────────────────────────────────────────────────────────────
function InfoRow({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 px-2 py-1">
      <span className="text-[10.5px] uppercase tracking-wide text-muted-foreground/70 w-[90px] flex-shrink-0">{label}</span>
      <span className={cn('text-[11.5px] text-foreground/90 flex-1 min-w-0 break-words', mono && 'font-mono')}>{value || '—'}</span>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, color }: { icon: LucideIcon; title: string; color?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2 pt-3 pb-1">
      <Icon className={cn('w-3 h-3', color || 'text-muted-foreground')} />
      <span className="text-[11px] font-semibold uppercase tracking-wide">{title}</span>
    </div>
  );
}

function EnvironmentTab({ env, sandbox }: { env: WorkspaceEnvironment; sandbox: WorkspaceSandbox }) {
  return (
    <ScrollArea className="h-full">
      <div className="p-2">
        {/* Agent */}
        <SectionHeader icon={Brain} title="Agent" color="text-emerald-500" />
        {env.agent ? (
          <div className="rounded-md bg-muted/20 border border-slate-200/60 dark:border-slate-800/60 px-1.5 py-1">
            <InfoRow label="Name" value={env.agent.name} />
            <InfoRow label="Slug" value={env.agent.slug} mono />
            <InfoRow label="Type" value={env.agent.type} />
            <InfoRow label="Temp" value={env.agent.temperature} mono />
            <InfoRow label="MaxTok" value={env.agent.maxTokens} mono />
            <InfoRow label="TopP" value={env.agent.topP} mono />
            {env.agent.description && <InfoRow label="Desc" value={env.agent.description} />}
          </div>
        ) : (
          <p className="px-2 py-2 text-[11px] text-muted-foreground">No agent info available</p>
        )}

        {/* Model */}
        <SectionHeader icon={Cpu} title="Model" color="text-purple-500" />
        {env.model ? (
          <div className="rounded-md bg-muted/20 border border-slate-200/60 dark:border-slate-800/60 px-1.5 py-1">
            <InfoRow label="Name" value={env.model.displayName || env.model.name} />
            <InfoRow label="ID" value={env.model.name} mono />
            <InfoRow label="Context" value={`${env.model.contextWindow.toLocaleString()} tok`} mono />
            <InfoRow label="MaxOut" value={`${env.model.maxOutputTokens.toLocaleString()} tok`} mono />
            <InfoRow label="Input$" value={`$${parseFloat(env.model.inputPricePer1k).toFixed(6)}/1k`} mono />
            <InfoRow label="Output$" value={`$${parseFloat(env.model.outputPricePer1k).toFixed(6)}/1k`} mono />
            <div className="flex flex-wrap gap-1 px-2 py-1.5">
              {env.model.supportsTools && <Badge variant="outline" className="text-[9px] h-4 px-1 gap-0.5"><Wrench className="w-2 h-2" />tools</Badge>}
              {env.model.supportsVision && <Badge variant="outline" className="text-[9px] h-4 px-1 gap-0.5"><Eye className="w-2 h-2" />vision</Badge>}
              {env.model.supportsThinking && <Badge variant="outline" className="text-[9px] h-4 px-1 gap-0.5"><Brain className="w-2 h-2" />thinking</Badge>}
              {env.model.supportsStreaming && <Badge variant="outline" className="text-[9px] h-4 px-1 gap-0.5"><Zap className="w-2 h-2" />stream</Badge>}
              {env.model.supportsJsonMode && <Badge variant="outline" className="text-[9px] h-4 px-1 gap-0.5"><FileJson className="w-2 h-2" />json</Badge>}
            </div>
          </div>
        ) : (
          <p className="px-2 py-2 text-[11px] text-muted-foreground">No model used yet in this session</p>
        )}

        {/* Provider */}
        <SectionHeader icon={Server} title="Provider" color="text-sky-500" />
        {env.provider ? (
          <div className="rounded-md bg-muted/20 border border-slate-200/60 dark:border-slate-800/60 px-1.5 py-1">
            <InfoRow label="Name" value={env.provider.name} />
            <InfoRow label="Slug" value={env.provider.slug} mono />
            <InfoRow label="Type" value={env.provider.type} mono />
            <InfoRow label="BaseURL" value={env.provider.baseUrl} mono />
            <InfoRow label="Status" value={env.provider.status} />
            <InfoRow label="Health" value={env.provider.healthStatus} />
          </div>
        ) : (
          <p className="px-2 py-2 text-[11px] text-muted-foreground">No provider info</p>
        )}

        {/* Sandbox / Runtime */}
        <SectionHeader icon={Box} title="Sandbox & Runtime" color="text-amber-500" />
        <div className="rounded-md bg-muted/20 border border-slate-200/60 dark:border-slate-800/60 px-1.5 py-1">
          <InfoRow label="Type" value={sandbox.sandbox.type} />
          <InfoRow label="Isolated" value={sandbox.sandbox.isolated ? 'yes' : 'no'} />
          <InfoRow label="Network" value={sandbox.sandbox.networkAccess ? 'allowed' : 'restricted'} />
          <InfoRow label="FS Access" value={sandbox.sandbox.filesystemAccess} />
          <InfoRow label="Runtime" value={`Node ${sandbox.runtime.nodeVersion}`} mono />
          <InfoRow label="Platform" value={`${sandbox.runtime.platform}/${sandbox.runtime.arch}`} mono />
          <InfoRow label="Uptime" value={`${Math.floor(sandbox.runtime.uptime)}s`} mono />
          <InfoRow label="Storage" value={sandbox.storage.driver} />
          <InfoRow label="StoragePath" value={sandbox.storage.basePath} mono />
          <InfoRow label="Files" value={sandbox.storage.filesCount} mono />
        </div>

        {/* Integrations */}
        <SectionHeader icon={Globe} title="Integrations" color="text-indigo-500" />
        <div className="grid grid-cols-2 gap-1.5 px-2 py-1.5">
          <IntegrationChip label="GitHub" icon={Github} enabled={sandbox.integrations.github} />
          <IntegrationChip label="Slack" icon={Slack} enabled={sandbox.integrations.slack} />
          <IntegrationChip label="Notion" icon={StickyNote} enabled={sandbox.integrations.notion} />
          <IntegrationChip label="Email" icon={Mail} enabled={sandbox.integrations.email} />
        </div>

        {/* Environment variables */}
        <SectionHeader icon={Terminal} title="Environment" color="text-rose-500" />
        <div className="rounded-md bg-muted/20 border border-slate-200/60 dark:border-slate-800/60 px-1.5 py-1">
          {Object.entries(sandbox.environment).map(([k, v]) => (
            <InfoRow key={k} label={k} value={v ? '✓ set' : '—'} mono />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}

function IntegrationChip({ label, icon: Icon, enabled }: { label: string; icon: LucideIcon; enabled: boolean }) {
  return (
    <div className={cn(
      'flex items-center gap-1.5 px-2 py-1.5 rounded-md border text-[11px]',
      enabled
        ? 'border-emerald-200/60 dark:border-emerald-900/40 bg-emerald-50/40 dark:bg-emerald-950/10 text-foreground'
        : 'border-slate-200/60 dark:border-slate-800/60 bg-muted/20 text-muted-foreground'
    )}>
      <Icon className={cn('w-3 h-3', enabled ? 'text-emerald-500' : 'text-muted-foreground/60')} />
      <span className="flex-1">{label}</span>
      {enabled ? (
        <CheckCircle2 className="w-3 h-3 text-emerald-500" />
      ) : (
        <CircleDashed className="w-3 h-3 text-muted-foreground/40" />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main WorkspacePanel
// ─────────────────────────────────────────────────────────────────────────────
export interface WorkspacePanelProps {
  sessionId: string;
  onClose: () => void;
}

export function WorkspacePanel({ sessionId, onClose }: WorkspacePanelProps) {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('files');
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/workspace`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.message || `HTTP ${res.status}`);
      }
      const json = await res.json();
      if (json.success) {
        setData(json.data);
        setError(null);
      } else {
        throw new Error(json?.error?.message || 'Failed to load workspace');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    setLoading(true);
    load();
    // Auto-refresh every 5 seconds while the panel is mounted
    refreshTimerRef.current = setInterval(load, 5000);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [load]);

  // Compute tab counts for badges
  const counts = {
    files: data?.files.length ?? 0,
    artifacts: data?.artifacts.length ?? 0,
    tools: data?.toolCalls.length ?? 0,
    activity: data?.messages.length ?? 0,
  };

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 380, damping: 36 }}
      className="w-[380px] flex-shrink-0 border-l border-slate-200 dark:border-slate-800 bg-background flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-muted/30">
        <div className="w-6 h-6 rounded-md bg-gradient-to-br from-slate-700 to-slate-900 dark:from-slate-600 dark:to-slate-800 flex items-center justify-center">
          <Box className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold leading-tight">Workspace</p>
          <p className="text-[10px] text-muted-foreground truncate">
            {data?.session.title || 'Loading…'}
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={load}
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              aria-label="Refresh workspace"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              aria-label="Close workspace"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
      </div>

      {/* Session stats bar */}
      {data && (
        <div className="px-2.5 py-2 border-b border-slate-200 dark:border-slate-800 grid grid-cols-2 gap-1.5">
          <StatPill icon={Activity} label="Messages" value={data.sandbox.session.messageCount || counts.activity} color="text-emerald-500" />
          <StatPill icon={Cpu} label="Tokens" value={data.session.totalTokens?.toLocaleString() ?? 0} color="text-purple-500" />
          <StatPill icon={Zap} label="Tools" value={counts.tools} color="text-amber-500" />
          <StatPill icon={FilesIcon} label="Files" value={counts.files} color="text-sky-500" />
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="px-3 py-1.5 bg-rose-50 dark:bg-rose-950/30 border-b border-rose-200 dark:border-rose-900 text-[11px] text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-rose-500">×</button>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="grid grid-cols-5 h-auto p-1 rounded-none border-b border-slate-200 dark:border-slate-800 bg-muted/20">
          <TabsTrigger value="files" className="text-[10.5px] gap-1 h-7 py-1">
            <FilesIcon className="w-3 h-3" />
            <span className="hidden xl:inline">Files</span>
            {counts.files > 0 && <span className="text-[9px] font-mono opacity-70">{counts.files}</span>}
          </TabsTrigger>
          <TabsTrigger value="artifacts" className="text-[10.5px] gap-1 h-7 py-1">
            <Box className="w-3 h-3" />
            <span className="hidden xl:inline">Arts</span>
            {counts.artifacts > 0 && <span className="text-[9px] font-mono opacity-70">{counts.artifacts}</span>}
          </TabsTrigger>
          <TabsTrigger value="tools" className="text-[10.5px] gap-1 h-7 py-1">
            <Wrench className="w-3 h-3" />
            <span className="hidden xl:inline">Tools</span>
            {counts.tools > 0 && <span className="text-[9px] font-mono opacity-70">{counts.tools}</span>}
          </TabsTrigger>
          <TabsTrigger value="activity" className="text-[10.5px] gap-1 h-7 py-1">
            <Activity className="w-3 h-3" />
            <span className="hidden xl:inline">Log</span>
            {counts.activity > 0 && <span className="text-[9px] font-mono opacity-70">{counts.activity}</span>}
          </TabsTrigger>
          <TabsTrigger value="env" className="text-[10.5px] gap-1 h-7 py-1">
            <Server className="w-3 h-3" />
            <span className="hidden xl:inline">Env</span>
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 min-h-0">
          {loading && !data ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <TabsContent value="files" className="m-0 h-full">
                {data && <FilesTab sessionId={sessionId} files={data.files} onRefresh={load} />}
              </TabsContent>
              <TabsContent value="artifacts" className="m-0 h-full">
                {data && <ArtifactsTab artifacts={data.artifacts} />}
              </TabsContent>
              <TabsContent value="tools" className="m-0 h-full">
                {data && <ToolsTab toolCalls={data.toolCalls} />}
              </TabsContent>
              <TabsContent value="activity" className="m-0 h-full">
                {data && <ActivityTab messages={data.messages} />}
              </TabsContent>
              <TabsContent value="env" className="m-0 h-full">
                {data && <EnvironmentTab env={data.environment} sandbox={data.sandbox} />}
              </TabsContent>
            </>
          )}
        </div>
      </Tabs>
    </motion.div>
  );
}

export default WorkspacePanel;
