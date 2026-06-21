'use client';

/**
 * MessageBubble — single message row in the chat transcript.
 *
 * Renders one of several message "types":
 *   - user       → right-aligned emerald bubble
 *   - assistant  → left-aligned, with avatar, markdown body, copy button,
 *                  optional ThinkingProcess, optional ToolCallCards,
 *                  optional ArtifactViewer, optional task metadata footer
 *   - tool_call  → inline ToolCallCard (standalone, no bubble)
 *   - tool_result→ inline ToolCallCard (when emitted standalone)
 *   - error      → rose-tinted card with alert icon
 *   - system     → centered muted pill
 *
 * The "streaming" prop shows a blinking caret at the end of assistant text
 * while chunks are arriving.
 */
import { useState, useCallback, memo } from 'react';
import {
  User, Bot, Copy, Check, AlertTriangle, Info, RefreshCw,
} from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ThinkingProcess, type ThinkingStep } from './ThinkingProcess';
import { ToolCallCard, type ToolCallData } from './ToolCallCard';
import { ArtifactViewer, type ArtifactItem } from './ArtifactViewer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getAgentTypeStyle } from '@/lib/agent-types';

export type MessageRole =
  | 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'error' | 'system';

export interface ChatMessageData {
  id: string;
  role: MessageRole;
  content: string;
  createdAt?: string;
  /** For assistant messages: thinking steps collected during streaming. */
  thinkingSteps?: ThinkingStep[];
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
  /** Agent type for color coding assistant avatars. */
  agentType?: string;
  /** Agent display name for assistant avatars. */
  agentName?: string;
  /** True while this message is actively receiving streamed chunks. */
  isStreaming?: boolean;
  /** True if this assistant turn failed. */
  isError?: boolean;
}

function Avatar({ role, agentType, agentName }: {
  role: MessageRole; agentType?: string; agentName?: string;
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
  // assistant
  const style = getAgentTypeStyle(agentType);
  const Icon = style.icon;
  return (
    <div
      className={`w-8 h-8 rounded-lg bg-gradient-to-br ${style.gradient} flex items-center justify-center text-white flex-shrink-0 shadow-sm`}
      title={agentName || style.label}
    >
      <Icon className="w-4 h-4" />
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
      className="h-7 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
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
    <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[10px] text-muted-foreground/70">
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
      <div className="flex gap-3 my-3 justify-start">
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
      </div>
    );
  }

  // Standalone tool_call/tool_result rows (rare — usually embedded in assistant)
  if (message.role === 'tool_call' || message.role === 'tool_result') {
    // These typically render via the assistant message's toolCalls array.
    // If a standalone row arrives, render as a card.
    if (message.toolCalls && message.toolCalls.length > 0) {
      return (
        <div className="my-1">
          {message.toolCalls.map(tc => <ToolCallCard key={tc.id} tool={tc} />)}
        </div>
      );
    }
    return null;
  }

  const isUser = message.role === 'user';
  const hasThinking = (message.thinkingSteps?.length ?? 0) > 0;
  const hasTools = (message.toolCalls?.length ?? 0) > 0;
  const hasArtifacts = (message.artifacts?.length ?? 0) > 0;
  const isEmpty = !message.content && !hasThinking && !hasTools && !hasArtifacts;

  return (
    <div className={`flex gap-3 my-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && <Avatar role={message.role} agentType={message.agentType} agentName={message.agentName} />}

      <div className={`group max-w-[85%] sm:max-w-[75%] ${isUser ? 'order-first' : ''}`}>
        {/* Agent label (assistant) */}
        {!isUser && message.agentName && (
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[11px] font-semibold text-foreground">
              {message.agentName}
            </span>
            {message.agentType && (
              <Badge variant="outline" className={`text-[9.5px] h-4 px-1.5 ${getAgentTypeStyle(message.agentType).softText}`}>
                {getAgentTypeStyle(message.agentType).label}
              </Badge>
            )}
            {message.isStreaming && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                generating…
              </span>
            )}
          </div>
        )}

        {/* Thinking process (collapsible) */}
        {!isUser && hasThinking && (
          <ThinkingProcess steps={message.thinkingSteps!} />
        )}

        {/* Main bubble */}
        <div
          className={`relative rounded-lg ${
            isUser
              ? 'bg-emerald-600 text-white rounded-tr-sm'
              : 'bg-card border rounded-tl-sm'
          } px-4 py-2.5 shadow-sm`}
        >
          {isUser ? (
            <p className="text-[14px] whitespace-pre-wrap break-words leading-relaxed">
              {message.content}
            </p>
          ) : isEmpty ? (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground py-1">
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span>Preparing response…</span>
            </div>
          ) : message.content ? (
            <div className="text-foreground">
              <MarkdownRenderer content={message.content} />
              {message.isStreaming && <StreamingCaret />}
            </div>
          ) : null}
        </div>

        {/* Tool calls (assistant only) */}
        {!isUser && hasTools && (
          <div className="mt-1">
            {message.toolCalls!.map(tc => <ToolCallCard key={tc.id} tool={tc} />)}
          </div>
        )}

        {/* Artifacts (assistant only) */}
        {!isUser && hasArtifacts && (
          <ArtifactViewer artifacts={message.artifacts!} />
        )}

        {/* Footer: actions + metadata + timestamp */}
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          {!isUser && (
            <CopyMessageButton text={message.content} />
          )}
          {message.metadata && <MessageMetadata metadata={message.metadata} />}
          {formatTime(message.createdAt) && (
            <span className="text-[10px] text-muted-foreground/50 ml-auto">
              {formatTime(message.createdAt)}
            </span>
          )}
        </div>
      </div>

      {isUser && <Avatar role="user" />}
    </div>
  );
});
