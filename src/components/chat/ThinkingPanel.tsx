'use client';

/**
 * ThinkingPanel — Manus-style "Thinking" panel that displays REAL reasoning
 * text streamed from the model (the SSE `thinking` event payload, i.e. the
 * model's `reasoning_content` / `thinking` delta).
 *
 * Design (Manus / Z.AI aesthetic):
 *   - Subtle gray rounded panel with a soft border
 *   - Italic muted text showing the model's actual chain-of-thought
 *   - Title row: "Thinking…" with a pulsing brain icon while active,
 *     "Thought for Ns" with a static icon when finished
 *   - Smooth height + opacity animation via framer-motion
 *   - Click header to collapse / expand
 *
 * IMPORTANT: This component intentionally does NOT fabricate steps like
 * "Analyzing request", "Synthesizing response", etc. It only renders the
 * real thinking text the backend streams. If no thinking text has arrived
 * yet, the panel renders nothing.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, ChevronRight, Sparkles } from 'lucide-react';

interface ThinkingPanelProps {
  /** Real thinking text from the model (accumulated across `thinking` SSE events). */
  content: string;
  /** True while the assistant message is still streaming. */
  isStreaming?: boolean;
  /** True once we know more thinking content could still arrive. */
  isActive?: boolean;
  /** Optional wall-clock duration of the thinking phase, in milliseconds. */
  durationMs?: number;
  /** Default expanded state on first mount. */
  defaultExpanded?: boolean;
}

function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null || ms <= 0) return '';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m ${rem}s`;
}

export function ThinkingPanel({
  content,
  isStreaming = false,
  isActive = false,
  durationMs,
  defaultExpanded = true,
}: ThinkingPanelProps) {
  // Auto-collapse shortly after thinking finishes, but let the user re-open.
  const [expanded, setExpanded] = useState(defaultExpanded);
  const wasActiveRef = useRef<boolean | null>(null);
  const userToggledRef = useRef(false);

  // Auto-expand when thinking first becomes active, auto-collapse 1.2s after it ends.
  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = isActive;

    if (userToggledRef.current) return;

    if (isActive && !wasActive) {
      // thinking just started — make sure it's open
      const t = setTimeout(() => setExpanded(true), 0);
      return () => clearTimeout(t);
    }
    if (!isActive && wasActive && !isStreaming) {
      // thinking just finished — collapse after a short delay
      const t = setTimeout(() => setExpanded(false), 1200);
      return () => clearTimeout(t);
    }
  }, [isActive, isStreaming]);

  const handleToggle = () => {
    userToggledRef.current = true;
    setExpanded(v => !v);
  };

  // Nothing to show if there's no real thinking text and we're not actively
  // expecting any (e.g. messages loaded from DB without thinking content).
  if (!content && !isActive) return null;

  const title = isActive
    ? 'Thinking…'
    : durationMs
      ? `Thought for ${formatDuration(durationMs)}`
      : 'Thinking';

  return (
    <div className="mb-2">
      <motion.div
        layout
        className="rounded-lg border border-slate-200/80 dark:border-slate-800/80 bg-slate-50/80 dark:bg-slate-900/40 overflow-hidden backdrop-blur-[1px]"
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      >
        {/* Header — clickable */}
        <button
          onClick={handleToggle}
          aria-expanded={expanded}
          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-100/70 dark:hover:bg-slate-800/40 transition-colors"
        >
          <motion.span
            animate={{ rotate: expanded ? 90 : 0 }}
            transition={{ duration: 0.18 }}
            className="flex-shrink-0"
          >
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          </motion.span>

          {isActive ? (
            <Brain className="w-3.5 h-3.5 text-purple-500 flex-shrink-0 animate-pulse" />
          ) : (
            <Brain className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          )}

          <span className="text-[12px] font-medium text-muted-foreground select-none">
            {title}
          </span>

          {!isActive && content && (
            <span className="ml-1 text-[11px] text-muted-foreground/60 hidden sm:inline">
              <Sparkles className="inline w-2.5 h-2.5 mr-0.5 -mt-0.5" />
              reasoning
            </span>
          )}

          <span className="ml-auto flex items-center gap-2">
            {isActive && (
              <span className="flex items-center gap-1 text-[10px] text-purple-500/80 font-mono">
                <span className="w-1 h-1 rounded-full bg-purple-500 animate-pulse" />
                live
              </span>
            )}
            {!isActive && durationMs !== undefined && (
              <span className="text-[10px] text-muted-foreground/60 font-mono">
                {formatDuration(durationMs)}
              </span>
            )}
          </span>
        </button>

        {/* Body — animated height */}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="body"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-3 pt-0.5">
                {content ? (
                  <div className="text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-400 italic whitespace-pre-wrap break-words font-serif">
                    {content}
                    {isActive && (
                      <span className="inline-block w-[6px] h-[12px] -mb-[1px] ml-0.5 bg-purple-400/80 animate-pulse rounded-[1px]" />
                    )}
                  </div>
                ) : (
                  <div className="text-[12px] text-muted-foreground/60 italic flex items-center gap-1.5 py-0.5">
                    <span className="flex gap-0.5">
                      <span className="w-1 h-1 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:-0.3s]" />
                      <span className="w-1 h-1 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:-0.15s]" />
                      <span className="w-1 h-1 rounded-full bg-muted-foreground/40 animate-bounce" />
                    </span>
                    waiting for model reasoning…
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

export default ThinkingPanel;
