'use client';

/**
 * MessageBubble — single message row in the chat transcript (Manus style).
 *
 * Layout:
 *   ┌────────────────────────────────────────────┐
 *   │ 🤖  Agent                                   │
 *   │     ┌─ ThinkingPanel (real model reasoning) │
 *   │     ├─ ToolCard 1 (human-readable)          │
 *   │     ├─ ToolCard 2 …                         │
 *   │     └─ Message body (Markdown)              │
 *   │     [Copy] · 1.2k tok · $0.001 · 2.3s       │
 *   └────────────────────────────────────────────┘
 *
 * Renders one of several message "types":
 *   - user       → right-aligned emerald bubble
 *   - assistant  → left-aligned, with avatar, thinking panel, tool cards,
 *                  markdown body, copy button, metadata footer
 *   - error      → rose-tinted card with alert icon
 *   - system     → centered muted pill
 */
import { useState, useCallback, memo } from 'react';
import { motion } from 'framer-motion';
import {
  User, Bot, Copy, Check, AlertTriangle, Info, RefreshCw, Sparkles,
} from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ThinkingPanel } from './ThinkingPanel';
import { ToolCard, type ToolCallData } from './ToolCard';
import { ArtifactViewer, type ArtifactItem } from './ArtifactViewer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export type MessageRole =
  | 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'error' | 'system';

export interface ChatMessageData {
  id: string;
  role: MessageRole;
  content: string;
  createdAt?: string;
  /** Real thinking text from the model (accumulated from SSE `thinking` events). */
  thinkingContent?: string;
  /** Wall-clock duration of the thinking phase in ms. */
  thinkingDurationMs?: number;
  /** True while more `thinking` events may still arrive for this message. */
  thinkingActive?: boolean;
  /** Tool calls associated with this assistant message. */
  toolCalls?: ToolCallData[];
  /** Artifacts produced alongside this message. */
  artifacts?: ArtifactItem[];
  /** Token usage and cost metadata (assistant only). */
  metadata?: {
    tokensUsed?: number;
    cost?: number;
    durationMs?: number;
    model?: string;
  };
  /** Agent display name (kept for compat — single universal agent). */
  agentType?: string;
  agentName?: string;
  /** True while this message is actively receiving streamed chunks. */
  isStreaming?: boolean;
  /** True if this assistant turn failed. */
  isError?: boolean;
}

function Avatar({ role, agentName }: {
  role: MessageRole; agentName?: string;
}) {
  if (role === 'user') {
    return (
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-600 to-slate-800 dark:from-slate-500 dark:to-slate-700 flex items-center justify-center text-white flex-shrink-0 shadow-sm">
        <User className="w-4 h-4" />
      </div>
    );
  }
  if (role === 'error') {
    return (
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500 to-red-600 flex items-center justify-center text-white flex-shrink-0 shadow-sm">
        <AlertTriangle className="w-4 h-4" />
      </div>
    );
  }
  // assistant — single universal agent (emerald/teal)
  return (
    <div
      className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white flex-shrink-0 shadow-sm"
      title={agentName || 'Agent'}
    >
      <Sparkles className="w-4 h-4" />
    </div>
  );
}

function CopyMessageButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handle = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);
  if (!text) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
      onClick={handle}
      aria-label="Copy message"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

function StreamingCaret() {
  return (
    <span
      className="inline-block w-[7px] h-[14px] -mb-[2px] ml-0.5 bg-emerald-500 animate-pulse rounded-sm"
      aria-hidden
    />
  );
}

function formatCost(cost?: number): string {
  if (cost === undefined || cost === null) return '';
  if (cost < 0.01) return `$${cost.toFixed(5)}`;
  return `$${cost.toFixed(4)}`;
}

function formatTokens(tokens?: number): string {
  if (!tokens) return '';
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return tokens.toLocaleString();
}

function formatTime(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function MessageMetadata({ metadata }: { metadata: NonNullable<ChatMessageData['metadata']> }) {
  const tokens = formatTokens(metadata.tokensUsed);
  const cost = formatCost(metadata.cost);
  const duration = metadata.durationMs !== undefined
    ? (metadata.durationMs < 1000 ? `${metadata.durationMs}ms` : `${(metadata.durationMs / 1000).toFixed(1)}s`)
    : '';
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground/70">
      {metadata.model && (
        <Badge variant="outline" className="text-[9.5px] h-4 px-1.5 font-mono">
          {metadata.model}
        </Badge>
      )}
      {tokens && <span className="font-mono">{tokens} tok</span>}
      {cost && <span className="font-mono">{cost}</span>}
      {duration && <span className="font-mono">{duration}</span>}
    </div>
  );
}

export const MessageBubble = memo(function MessageBubble({ message }: { message: ChatMessageData }) {
  // System / pill messages
  if (message.role === 'system') {
    return (
      <div className="flex justify-center my-2">
        <div className="px-3 py-1 rounded-full bg-muted text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Info className="w-3 h-3" />
          {message.content}
        </div>
      </div>
    );
  }

  // Standalone error (not from assistant)
  if (message.role === 'error') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex gap-3 my-3 justify-start"
      >
        <Avatar role="error" />
        <div className="max-w-[85%] sm:max-w-[75%]">
          <div className="rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 p-3">
            <div className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400 text-[12px] font-medium mb-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              Error
            </div>
            <p className="text-[13px] text-rose-700 dark:text-rose-300 whitespace-pre-wrap break-words">
              {message.content}
            </p>
          </div>
          <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground/60">
            <span>{formatTime(message.createdAt)}</span>
          </div>
        </div>
      </motion.div>
    );
  }

  // Standalone tool_call/tool_result rows (rare — usually embedded in assistant)
  if (message.role === 'tool_call' || message.role === 'tool_result') {
    if (message.toolCalls && message.toolCalls.length > 0) {
      return (
        <div className="my-1 pl-11">
          {message.toolCalls.map(tc => <ToolCard key={tc.id} tool={tc} />)}
        </div>
      );
    }
    return null;
  }

  const isUser = message.role === 'user';
  const hasThinking = !!(message.thinkingContent || message.thinkingActive);
  const hasTools = (message.toolCalls?.length ?? 0) > 0;
  const hasArtifacts = (message.artifacts?.length ?? 0) > 0;
  const isEmpty = !message.content && !hasThinking && !hasTools && !hasArtifacts;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
      className={`flex gap-3 my-3 ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      {!isUser && <Avatar role={message.role} agentName={message.agentName} />}

      <div className={`group max-w-[85%] sm:max-w-[75%] ${isUser ? 'order-first' : ''}`}>
        {/* Agent label (assistant) */}
        {!isUser && (
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[11px] font-semibold text-foreground">
              {message.agentName || 'Agent'}
            </span>
            {message.isStreaming && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                generating…
              </span>
            )}
          </div>
        )}

        {/* Thinking panel — shows REAL model reasoning */}
        {!isUser && hasThinking && (
          <ThinkingPanel
            content={message.thinkingContent || ''}
            isActive={message.thinkingActive}
            isStreaming={message.isStreaming}
            durationMs={message.thinkingDurationMs}
          />
        )}

        {/* Main bubble */}
        <div
          className={`relative rounded-2xl ${
            isUser
              ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white rounded-tr-md'
              : 'bg-card border rounded-tl-md'
          } px-4 py-2.5 shadow-sm`}
        >
          {isUser ? (
            <p className="text-[14px] whitespace-pre-wrap break-words leading-relaxed">
              {message.content}
            </p>
          ) : isEmpty ? (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground py-1">
              <span className="flex gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" />
              </span>
              <span>Preparing response…</span>
            </div>
          ) : message.content ? (
            <div className="text-foreground">
              <MarkdownRenderer content={message.content} />
              {message.isStreaming && <StreamingCaret />}
            </div>
          ) : null}
        </div>

        {/* Tool calls (assistant only) — clean human-readable cards */}
        {!isUser && hasTools && (
          <div className="mt-1.5 space-y-0">
            {message.toolCalls!.map(tc => <ToolCard key={tc.id} tool={tc} />)}
          </div>
        )}

        {/* Artifacts (assistant only) */}
        {!isUser && hasArtifacts && (
          <ArtifactViewer artifacts={message.artifacts!} />
        )}

        {/* Footer: actions + metadata + timestamp */}
        {!isUser && (message.content || hasTools) && (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            <CopyMessageButton text={message.content} />
            {message.metadata && <MessageMetadata metadata={message.metadata} />}
            {formatTime(message.createdAt) && (
              <span className="text-[10px] text-muted-foreground/50 ml-auto">
                {formatTime(message.createdAt)}
              </span>
            )}
          </div>
        )}
      </div>

      {isUser && <Avatar role="user" />}
    </motion.div>
  );
});

export default MessageBubble;
