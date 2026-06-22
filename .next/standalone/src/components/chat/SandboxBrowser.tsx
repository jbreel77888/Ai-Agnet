'use client';

/**
 * SandboxBrowser — file browser for the session's stateful Tensorlake sandbox.
 * ─────────────────────────────────────────────────────────────────────────────
 * Shows a file tree of /home/tl-user (the sandbox home). The agent can write
 * files there via file_manager tool, and the user can:
 *   - Browse directories (click to enter)
 *   - Preview text/image files (click to open)
 *   - Download any file (download button)
 *   - Refresh the listing
 *
 * Data source: GET /api/sessions/[id]/sandbox?path=...
 */
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Folder, File as FileIcon, FileText, FileCode, FileJson, Image as ImageIcon,
  Download, Eye, RefreshCw, ChevronRight, Home, ArrowLeft, X, Loader2,
  AlertCircle, FileSpreadsheet, FileType,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const SANDBOX_HOME = '/home/tl-user';

interface SandboxEntry {
  name: string;
  type: string; // 'file' | 'directory'
  size: number;
  modifiedAt: string | null;
  path: string;
}

interface PreviewData {
  path: string;
  type: 'text' | 'image' | 'binary';
  mimeType: string;
  size: number;
  content: string | null;
  truncated?: boolean;
}

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

function fileIcon(name: string, type: string) {
  if (type === 'directory') return Folder;
  const ext = name.split('.').pop()?.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext || '')) return ImageIcon;
  if (['json'].includes(ext || '')) return FileJson;
  if (['csv', 'tsv', 'xlsx', 'xls'].includes(ext || '')) return FileSpreadsheet;
  if (['js', 'ts', 'tsx', 'jsx', 'py', 'sh', 'bash', 'go', 'rs', 'java', 'c', 'cpp', 'rb', 'php'].includes(ext || '')) return FileCode;
  if (['md', 'txt', 'log', 'yml', 'yaml', 'xml', 'html', 'css', 'sql'].includes(ext || '')) return FileText;
  return FileIcon;
}

function isPreviewable(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp',
          'txt', 'md', 'json', 'csv', 'html', 'js', 'ts', 'tsx', 'jsx',
          'py', 'sh', 'bash', 'go', 'rs', 'java', 'c', 'cpp', 'rb', 'php',
          'yml', 'yaml', 'xml', 'log', 'css', 'sql', 'tsv'].includes(ext || '');
}

export function SandboxBrowser({ sessionId }: { sessionId: string }) {
  const [currentPath, setCurrentPath] = useState(SANDBOX_HOME);
  const [entries, setEntries] = useState<SandboxEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([SANDBOX_HOME]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/sandbox?path=${encodeURIComponent(path)}`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.message || `HTTP ${res.status}`);
      }
      const json = await res.json();
      if (json.success) {
        setEntries(json.data.entries || []);
        setCurrentPath(path);
      } else {
        throw new Error(json?.error?.message || 'Failed to list directory');
      }
    } catch (err: any) {
      setError(err.message);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    loadDirectory(SANDBOX_HOME);
  }, [loadDirectory]);

  const navigateTo = useCallback((path: string) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(path);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    loadDirectory(path);
  }, [history, historyIndex, loadDirectory]);

  const goBack = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      loadDirectory(history[newIndex]);
    }
  }, [history, historyIndex, loadDirectory]);

  const goForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      loadDirectory(history[newIndex]);
    }
  }, [history, historyIndex, loadDirectory]);

  const goHome = useCallback(() => {
    navigateTo(SANDBOX_HOME);
  }, [navigateTo]);

  const goUp = useCallback(() => {
    if (currentPath === SANDBOX_HOME) return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const parent = parts.length > 0 ? `/${parts.join('/')}` : '/';
    if (parent.startsWith(SANDBOX_HOME) || parent === '/') {
      navigateTo(parent === '/' ? SANDBOX_HOME : parent);
    }
  }, [currentPath, navigateTo]);

  const handleEntryClick = useCallback((entry: SandboxEntry) => {
    if (entry.type === 'directory') {
      navigateTo(entry.path);
    } else if (isPreviewable(entry.name)) {
      // Open preview
      setPreviewLoading(true);
      setPreview(null);
      fetch(`/api/sessions/${sessionId}/sandbox?path=${encodeURIComponent(entry.path)}&preview=1`, {
        headers: authHeaders(),
      })
        .then(res => res.json())
        .then(json => {
          if (json.success) {
            setPreview(json.data);
          } else {
            setPreview({
              path: entry.path,
              type: 'text',
              mimeType: 'text/plain',
              size: 0,
              content: `Error: ${json?.error?.message || 'Failed to load'}`,
            });
          }
        })
        .catch(err => {
          setPreview({
            path: entry.path,
            type: 'text',
            mimeType: 'text/plain',
            size: 0,
            content: `Error: ${err.message}`,
          });
        })
        .finally(() => setPreviewLoading(false));
    }
  }, [sessionId, navigateTo]);

  const handleDownload = useCallback(async (entry: SandboxEntry) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/sandbox?path=${encodeURIComponent(entry.path)}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const blob = new Blob([buf]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = entry.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err: any) {
      alert('Download failed: ' + err.message);
    }
  }, [sessionId]);

  // Breadcrumb path segments
  const breadcrumbs = currentPath.split('/').filter(Boolean);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-slate-200/60 dark:border-slate-800/60 bg-muted/20">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={goBack}
          disabled={historyIndex === 0}
          title="Back"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={goForward}
          disabled={historyIndex >= history.length - 1}
          title="Forward"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={goHome}
          title="Home"
        >
          <Home className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={goUp}
          disabled={currentPath === SANDBOX_HOME}
          title="Up one level"
        >
          <ArrowLeft className="w-3.5 h-3.5 rotate-90" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={() => loadDirectory(currentPath)}
          title="Refresh"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </Button>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-0.5 ml-2 flex-1 min-w-0 overflow-x-auto">
          <button
            onClick={goHome}
            className="text-[11px] px-1.5 py-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground whitespace-nowrap"
          >
            ~
          </button>
          {breadcrumbs.map((seg, i) => {
            const fullPath = '/' + breadcrumbs.slice(0, i + 1).join('/');
            const isLast = i === breadcrumbs.length - 1;
            return (
              <div key={i} className="flex items-center gap-0.5">
                <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
                <button
                  onClick={() => !isLast && navigateTo(fullPath)}
                  className={cn(
                    'text-[11px] px-1.5 py-0.5 rounded whitespace-nowrap',
                    isLast
                      ? 'bg-muted text-foreground font-medium'
                      : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                  )}
                >
                  {seg}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-2 bg-rose-50 dark:bg-rose-950/30 border-b border-rose-200 dark:border-rose-900 text-[11px] text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-rose-500">×</button>
        </div>
      )}

      {/* File list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Folder className="w-8 h-8 text-muted-foreground/40 mb-2" />
              <p className="text-[12px] text-muted-foreground">Empty directory</p>
              <p className="text-[10.5px] text-muted-foreground/60 mt-1">
                Files created by the agent will appear here
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {/* Directories first, then files */}
              {[...entries]
                .sort((a, b) => {
                  if (a.type === 'directory' && b.type !== 'directory') return -1;
                  if (a.type !== 'directory' && b.type === 'directory') return 1;
                  return a.name.localeCompare(b.name);
                })
                .map(entry => {
                  const Icon = fileIcon(entry.name, entry.type);
                  const isDir = entry.type === 'directory';
                  return (
                    <motion.div
                      key={entry.path}
                      layout
                      initial={{ opacity: 0, y: -2 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/40 cursor-pointer transition-colors"
                      onClick={() => handleEntryClick(entry)}
                    >
                      <Icon className={cn(
                        'w-4 h-4 flex-shrink-0',
                        isDir ? 'text-amber-500' : 'text-sky-500'
                      )} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] truncate">{entry.name}</p>
                      </div>
                      {!isDir && (
                        <>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {formatBytes(entry.size)}
                          </span>
                          {isPreviewable(entry.name) && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleEntryClick(entry); }}
                                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100"
                                  aria-label="Preview"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>Preview</TooltipContent>
                            </Tooltip>
                          )}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDownload(entry); }}
                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100"
                                aria-label="Download"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Download</TooltipContent>
                          </Tooltip>
                        </>
                      )}
                    </motion.div>
                  );
                })}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Status bar */}
      <div className="px-3 py-1.5 border-t border-slate-200/60 dark:border-slate-800/60 bg-muted/20 text-[10px] text-muted-foreground flex items-center justify-between">
        <span>{entries.length} items</span>
        <span className="font-mono truncate ml-2">{currentPath}</span>
      </div>

      {/* Preview modal */}
      <AnimatePresence>
        {preview && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => { setPreview(null); setPreviewLoading(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-background rounded-lg border shadow-xl max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col"
            >
              <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-muted/40">
                {preview.type === 'image' ? <ImageIcon className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                <span className="text-[12.5px] font-medium truncate flex-1">
                  {preview.path.split('/').pop()}
                </span>
                <Badge variant="outline" className="text-[10px] h-5">
                  {formatBytes(preview.size)}
                </Badge>
                {preview.mimeType && (
                  <Badge variant="outline" className="text-[9px] h-5 font-mono">
                    {preview.mimeType}
                  </Badge>
                )}
                <button
                  onClick={() => setPreview(null)}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-950">
                {previewLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : preview.type === 'image' ? (
                  <div className="flex items-center justify-center p-4 min-h-[300px]">
                    {preview.content && (
                      <img
                        src={preview.content}
                        alt={preview.path.split('/').pop() || 'preview'}
                        className="max-w-full max-h-[70vh] rounded shadow"
                      />
                    )}
                  </div>
                ) : preview.type === 'text' ? (
                  <pre className="m-0 p-4 text-[12px] font-mono whitespace-pre-wrap break-words text-foreground">
                    {preview.content || '(empty file)'}
                    {preview.truncated && (
                      <span className="text-muted-foreground italic">
                        {'\n\n... [truncated for preview — download for full content]'}
                      </span>
                    )}
                  </pre>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <FileType className="w-10 h-10 text-muted-foreground/40 mb-2" />
                    <p className="text-[13px] font-medium">Binary file</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Preview not available. Use the download button to save the file.
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default SandboxBrowser;
