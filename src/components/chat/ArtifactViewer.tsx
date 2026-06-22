'use client';

/**
 * ArtifactViewer — tabbed panel for files / artifacts produced by an agent.
 *
 * Supports artifact types:
 *   - code   → syntax highlighted (Prism one-dark) + copy button
 *   - image  → base64 or URL, responsive
 *   - text   → plain mono-spaced
 *   - json   → pretty-printed JSON
 *
 * Features:
 *   - Tabbed interface when there are multiple artifacts
 *   - Download button per artifact (creates a Blob URL and triggers download)
 *   - Copy button for text/code/json artifacts
 *   - Empty state when no artifacts exist
 */
import { useState, useMemo, useCallback } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  FileText, FileCode, FileJson, Image as ImageIcon, Download,
  Copy, Check, Files, FileDown,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export type ArtifactType = 'code' | 'text' | 'json' | 'image' | 'html' | 'csv' | 'svg';

export interface ArtifactItem {
  id: string;
  name: string;
  type: ArtifactType;
  /** For code/text/json: the content. For image: a data URL or remote URL. */
  content: string;
  /** Language hint for syntax highlighting (code only). */
  language?: string;
  /** MIME type for download (defaults to text/plain). */
  mimeType?: string;
  /** Size in bytes (optional, shown in tab tooltip). */
  sizeBytes?: number;
}

function detectLanguage(name: string, hint?: string): string {
  if (hint) return hint;
  const ext = name.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
    rb: 'ruby', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash',
    yml: 'yaml', yaml: 'yaml', json: 'json', xml: 'xml', html: 'html',
    css: 'css', scss: 'scss', sql: 'sql', md: 'markdown', markdown: 'markdown',
    c: 'c', cpp: 'cpp', cs: 'csharp', swift: 'swift',
  };
  return (ext && map[ext]) || 'text';
}

function detectType(name: string, content: string, declaredType?: ArtifactType): ArtifactType {
  if (declaredType && declaredType !== 'text') return declaredType;
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (ext === 'svg') return 'svg';
  if (ext === 'json') return 'json';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'].includes(ext || '')) return 'image';
  if (content?.trimStart().startsWith('<!DOCTYPE html') || content?.trimStart().startsWith('<html')) return 'html';
  if (content?.trimStart().startsWith('<?xml') && content?.includes('<svg')) return 'svg';
  return 'text';
}

function formatSize(bytes?: number): string {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ArtifactIcon({ type }: { type: ArtifactType }) {
  const cls = 'w-3.5 h-3.5';
  switch (type) {
    case 'code':  return <FileCode className={cls} />;
    case 'json':  return <FileJson className={cls} />;
    case 'image': return <ImageIcon className={cls} />;
    default:      return <FileText className={cls} />;
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handle = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);
  return (
    <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] gap-1" onClick={handle}>
      {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

function DownloadButton({ artifact }: { artifact: ArtifactItem }) {
  const handle = useCallback(() => {
    let blob: Blob;
    if (artifact.type === 'image') {
      // For data URLs, fetch then blob; for remote URLs, open in new tab
      if (artifact.content.startsWith('data:')) {
        fetch(artifact.content).then(r => r.blob()).then(b => {
          const url = URL.createObjectURL(b);
          triggerDownload(url, artifact.name);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
        return;
      }
      window.open(artifact.content, '_blank');
      return;
    }
    blob = new Blob([artifact.content], { type: artifact.mimeType || 'text/plain' });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, artifact.name);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [artifact]);

  return (
    <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] gap-1" onClick={handle}>
      <Download className="w-3 h-3" />
      Download
    </Button>
  );
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function ArtifactContent({ artifact }: { artifact: ArtifactItem }) {
  // Auto-detect type if not explicitly set
  const effectiveType = detectType(artifact.name, artifact.content, artifact.type);

  if (effectiveType === 'image') {
    return (
      <div className="flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-900/40 min-h-[200px]">
        <img
          src={artifact.content}
          alt={artifact.name}
          className="max-w-full max-h-[60vh] rounded border shadow-sm"
        />
      </div>
    );
  }

  // SVG — render inline (vector graphics)
  if (effectiveType === 'svg') {
    return (
      <div className="flex items-center justify-center p-4 bg-white dark:bg-slate-900/40 min-h-[200px]">
        <div
          className="max-w-full max-h-[60vh]"
          dangerouslySetInnerHTML={{ __html: artifact.content }}
        />
      </div>
    );
  }

  // HTML — render in sandboxed iframe (live preview)
  if (effectiveType === 'html') {
    const blob = new Blob([artifact.content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    return (
      <div className="bg-white" style={{ height: '400px' }}>
        <iframe
          src={url}
          title={artifact.name}
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          onLoad={() => {
            // Revoke after load to free memory (keep reference for re-renders)
          }}
        />
      </div>
    );
  }

  // CSV — render as interactive table
  if (effectiveType === 'csv') {
    return <CsvTable content={artifact.content} />;
  }

  if (effectiveType === 'json') {
    let pretty = artifact.content;
    try {
      pretty = JSON.stringify(JSON.parse(artifact.content), null, 2);
    } catch {
      // not JSON, show raw
    }
    return (
      <pre className="m-0 p-3 text-[12px] font-mono text-slate-200 overflow-auto max-h-[60vh] bg-[#1e1e2e]">
        {pretty}
      </pre>
    );
  }

  if (effectiveType === 'code') {
    const lang = detectLanguage(artifact.name, artifact.language);
    return (
      <SyntaxHighlighter
        language={lang}
        style={oneDark}
        customStyle={{
          margin: 0,
          padding: '12px 14px',
          fontSize: '12.5px',
          background: '#1e1e2e',
          maxHeight: '60vh',
        }}
        codeTagProps={{ style: { fontFamily: 'var(--font-geist-mono), ui-monospace, monospace' } }}
        wrapLongLines
      >
        {artifact.content}
      </SyntaxHighlighter>
    );
  }

  // plain text
  return (
    <pre className="m-0 p-3 text-[12.5px] font-mono text-slate-700 dark:text-slate-300 overflow-auto max-h-[60vh] whitespace-pre-wrap break-words">
      {artifact.content}
    </pre>
  );
}

/**
 * CSV Table — renders CSV/TSV content as an interactive HTML table.
 */
function CsvTable({ content }: { content: string }) {
  const rows = content.trim().split(/\r?\n/).map(row => {
    // Simple CSV parser (handles quoted fields with commas)
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '"') {
        if (inQuotes && row[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        cells.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current);
    return cells;
  });

  if (rows.length === 0) return <div className="p-3 text-[12px] text-muted-foreground">Empty CSV</div>;

  const headers = rows[0];
  const dataRows = rows.slice(1);

  return (
    <div className="overflow-auto max-h-[60vh] bg-white">
      <table className="min-w-full text-[12px] border-collapse">
        <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="px-3 py-1.5 text-left font-semibold border-b border-slate-200 dark:border-slate-700 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row, i) => (
            <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
              {headers.map((_, j) => (
                <td key={j} className="px-3 py-1.5 border-b border-slate-100 dark:border-slate-800 whitespace-nowrap">
                  {row[j] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-3 py-1 text-[10px] text-muted-foreground bg-slate-50 dark:bg-slate-900/40 border-t">
        {dataRows.length} rows × {headers.length} columns
      </div>
    </div>
  );
}

export function ArtifactViewer({ artifacts }: { artifacts: ArtifactItem[] }) {
  const [activeId, setActiveId] = useState(artifacts[0]?.id);

  // Keep active tab valid if artifacts list changes
  const safeActive = useMemo(() => {
    if (artifacts.find(a => a.id === activeId)) return activeId;
    return artifacts[0]?.id;
  }, [artifacts, activeId]);

  if (artifacts.length === 0) return null;

  if (artifacts.length === 1) {
    const a = artifacts[0];
    return (
      <div className="rounded-lg border overflow-hidden my-2">
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-800/80 border-b">
          <ArtifactIcon type={a.type} />
          <span className="text-[12px] font-mono font-medium truncate flex-1">{a.name}</span>
          {a.sizeBytes !== undefined && (
            <Badge variant="outline" className="text-[10px] h-5 font-mono">
              {formatSize(a.sizeBytes)}
            </Badge>
          )}
          {a.type !== 'image' && <CopyButton text={a.content} />}
          <DownloadButton artifact={a} />
        </div>
        <ArtifactContent artifact={a} />
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden my-2">
      <Tabs value={safeActive} onValueChange={setActiveId}>
        <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-100 dark:bg-slate-800/80 border-b">
          <Files className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-[11px] font-medium text-muted-foreground mr-1">
            {artifacts.length} artifacts
          </span>
        </div>
        <TabsList className="bg-slate-100 dark:bg-slate-800/60 rounded-none border-b w-full justify-start h-auto p-1 flex-wrap">
          {artifacts.map(a => (
            <TabsTrigger
              key={a.id}
              value={a.id}
              className="text-[11px] gap-1.5 data-[state=active]:bg-background"
            >
              <ArtifactIcon type={a.type} />
              <span className="truncate max-w-[120px] font-mono">{a.name}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        {artifacts.map(a => (
          <TabsContent key={a.id} value={a.id} className="m-0">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 dark:bg-slate-900/40 border-b">
              <span className="text-[11px] text-muted-foreground font-mono truncate flex-1">{a.name}</span>
              {a.sizeBytes !== undefined && (
                <Badge variant="outline" className="text-[10px] h-5 font-mono">
                  {formatSize(a.sizeBytes)}
                </Badge>
              )}
              {a.type !== 'image' && <CopyButton text={a.content} />}
              <DownloadButton artifact={a} />
            </div>
            <ArtifactContent artifact={a} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

export { FileDown };
