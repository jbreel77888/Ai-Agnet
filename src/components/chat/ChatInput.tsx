'use client';

/**
 * ChatInput — Manus-style message input with two dropdown buttons on the left
 * and a send / stop button on the right.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ [💡 Plan]  [⚙ Model ▾]                                         │
 *   │   ┌────────────────────────────────────────────────────────┐  │
 *   │   │  Message…                                  [↑ Send]   │  │
 *   │   └────────────────────────────────────────────────────────┘  │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Buttons:
 *   1. **Plan Mode** (lightbulb) — toggles plan-first mode. When on, the
 *      button is highlighted amber and the assistant is asked to outline
 *      a plan before executing. The state is sent to the backend by
 *      prefixing the user message with a `[Plan Mode]` directive.
 *   2. **Model Mode** (sliders) — opens a dropdown listing all available
 *      models plus capability-based toggles (Thinking, Tool Use, JSON Mode)
 *      that are dynamically enabled/disabled based on the selected model's
 *      actual features (from GET /api/models). The chosen `modelId` is
 *      passed through `onSend`.
 */
import {
  useState, useRef, useEffect, useCallback, type KeyboardEvent,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send, Square, Lightbulb, SlidersHorizontal, Check,
  Brain, Wrench, Braces, Eye, Sparkles, ChevronRight,
  Cpu, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem,
  DropdownMenuCheckboxItem, DropdownMenuGroup,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export interface ModelOption {
  id: string;
  name: string;
  displayName?: string;
  providerName: string;
  providerSlug: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  supportsThinking: boolean;
  supportsJsonMode: boolean;
}

export interface ModelModeState {
  modelId: string | null;
  thinkingEnabled: boolean;
  toolUseEnabled: boolean;
  jsonModeEnabled: boolean;
}

interface ChatInputProps {
  value: string;
  onChange: (v: string) => void;
  onSend: (opts: { content: string; planMode: boolean; modelMode: ModelModeState }) => void;
  onStop: () => void;
  sending: boolean;
  disabled?: boolean;
  placeholder?: string;
  models: ModelOption[];
  modelMode: ModelModeState;
  onModelModeChange: (next: ModelModeState) => void;
  planMode: boolean;
  onPlanModeChange: (next: boolean) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function formatContext(n?: number): string {
  if (!n) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function shortModelName(m: ModelOption): string {
  return m.displayName || m.name;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan Mode button
// ─────────────────────────────────────────────────────────────────────────────
function PlanModeButton({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => onToggle(!enabled)}
      className={cn(
        'h-8 gap-1.5 px-2.5 rounded-lg text-[12px] font-medium transition-all',
        enabled
          ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-900/50'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      )}
      aria-pressed={enabled}
      title={enabled ? 'Plan mode is ON — agent will outline a plan first' : 'Plan mode is OFF — agent acts directly'}
    >
      <Lightbulb className={cn('w-3.5 h-3.5', enabled && 'fill-amber-400/30 text-amber-500')} />
      <span className="hidden sm:inline">Plan</span>
      {enabled && (
        <motion.span
          layout
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="ml-0.5 inline-flex items-center text-[9px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400"
        >
          on
        </motion.span>
      )}
    </Button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Mode button + dropdown
// ─────────────────────────────────────────────────────────────────────────────
function ModelModeButton({
  models, modelMode, onChange,
}: {
  models: ModelOption[];
  modelMode: ModelModeState;
  onChange: (next: ModelModeState) => void;
}) {
  const selected = models.find(m => m.id === modelMode.modelId) ?? null;
  const label = selected ? shortModelName(selected) : 'Auto';

  const update = (patch: Partial<ModelModeState>) => {
    onChange({ ...modelMode, ...patch });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2.5 rounded-lg text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted"
          title="Model & capabilities"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span className="hidden sm:inline truncate max-w-[120px]">{label}</span>
          {modelMode.thinkingEnabled && selected?.supportsThinking && (
            <Brain className="w-3 h-3 text-purple-500" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[320px] max-h-[420px] overflow-y-auto">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground/80 flex items-center gap-1.5">
          <Cpu className="w-3 h-3" /> Model
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Auto option */}
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => update({ modelId: null })}
            className="gap-2 cursor-pointer"
          >
            <div className="flex-1 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
              <div className="flex flex-col">
                <span className="text-[12.5px] font-medium">Auto-select</span>
                <span className="text-[10.5px] text-muted-foreground">Let the platform pick the best model</span>
              </div>
            </div>
            {modelMode.modelId === null && <Check className="w-3.5 h-3.5 text-emerald-500" />}
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {/* Model list */}
        <DropdownMenuGroup>
          {models.length === 0 ? (
            <div className="px-2 py-3 text-[11.5px] text-muted-foreground text-center">
              No models configured
            </div>
          ) : (
            models.map(m => {
              const isSelected = m.id === modelMode.modelId;
              return (
                <DropdownMenuItem
                  key={m.id}
                  onClick={() => update({
                    modelId: m.id,
                    // Auto-disable toggles that the new model can't support
                    thinkingEnabled: m.supportsThinking ? modelMode.thinkingEnabled : false,
                    toolUseEnabled: m.supportsTools ? modelMode.toolUseEnabled : false,
                    jsonModeEnabled: m.supportsJsonMode ? modelMode.jsonModeEnabled : false,
                  })}
                  className="gap-2 cursor-pointer"
                >
                  <div className="flex-1 flex items-center gap-2 min-w-0">
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-[12.5px] font-medium truncate">{shortModelName(m)}</span>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className="truncate">{m.providerName}</span>
                        {m.contextWindow && (
                          <>
                            <span>·</span>
                            <span className="font-mono">{formatContext(m.contextWindow)} ctx</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      {m.supportsThinking && <span title="supports thinking"><Brain className="w-3 h-3 text-purple-500" /></span>}
                      {m.supportsTools && <span title="supports tools"><Wrench className="w-3 h-3 text-cyan-500" /></span>}
                      {m.supportsVision && <span title="supports vision"><Eye className="w-3 h-3 text-sky-500" /></span>}
                      {m.supportsJsonMode && <span title="supports JSON mode"><Braces className="w-3 h-3 text-amber-500" /></span>}
                    </div>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />}
                </DropdownMenuItem>
              );
            })
          )}
        </DropdownMenuGroup>

        {/* Capability toggles — dynamic based on selected model */}
        {selected && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground/80 flex items-center gap-1.5">
              <Zap className="w-3 h-3" /> Capabilities
            </DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={modelMode.thinkingEnabled}
              disabled={!selected.supportsThinking}
              onCheckedChange={(c) => update({ thinkingEnabled: !!c })}
              className="gap-2"
            >
              <Brain className="w-3.5 h-3.5 text-purple-500" />
              <span>Thinking</span>
              {!selected.supportsThinking && (
                <span className="ml-auto text-[10px] text-muted-foreground/60">unsupported</span>
              )}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={modelMode.toolUseEnabled}
              disabled={!selected.supportsTools}
              onCheckedChange={(c) => update({ toolUseEnabled: !!c })}
              className="gap-2"
            >
              <Wrench className="w-3.5 h-3.5 text-cyan-500" />
              <span>Tool use</span>
              {!selected.supportsTools && (
                <span className="ml-auto text-[10px] text-muted-foreground/60">unsupported</span>
              )}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={modelMode.jsonModeEnabled}
              disabled={!selected.supportsJsonMode}
              onCheckedChange={(c) => update({ jsonModeEnabled: !!c })}
              className="gap-2"
            >
              <Braces className="w-3.5 h-3.5 text-amber-500" />
              <span>JSON mode</span>
              {!selected.supportsJsonMode && (
                <span className="ml-auto text-[10px] text-muted-foreground/60">unsupported</span>
              )}
            </DropdownMenuCheckboxItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main ChatInput
// ─────────────────────────────────────────────────────────────────────────────
export function ChatInput({
  value, onChange, onSend, onStop, sending, disabled,
  placeholder, models, modelMode, onModelModeChange,
  planMode, onPlanModeChange,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow textarea height
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [value]);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || sending || disabled) return;
    onSend({ content: trimmed, planMode, modelMode });
  }, [value, sending, disabled, onSend, planMode, modelMode]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="w-full">
      <div className="rounded-2xl border bg-card shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-emerald-500/25 focus-within:border-emerald-500/40">
        {/* Top row: dropdown buttons */}
        <div className="flex items-center gap-1 px-2 pt-2">
          <PlanModeButton enabled={planMode} onToggle={onPlanModeChange} />
          <ModelModeButton
            models={models}
            modelMode={modelMode}
            onChange={onModelModeChange}
          />
          <div className="flex-1" />
          {planMode && (
            <motion.span
              layout
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -4 }}
            >
              <Badge variant="outline" className="text-[10px] h-5 gap-1 bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900">
                <Lightbulb className="w-2.5 h-2.5" />
                Plan first
              </Badge>
            </motion.span>
          )}
        </div>

        {/* Bottom row: textarea + send button */}
        <div className="flex items-end gap-2 px-2 pb-2 pt-1">
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder || 'Message the agent…  (Enter to send, Shift+Enter for newline)'}
            disabled={disabled || sending}
            rows={1}
            className="flex-1 min-h-[44px] max-h-[200px] resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-[14px] leading-relaxed px-2 py-2.5"
          />
          <AnimatePresence mode="wait" initial={false}>
            {sending ? (
              <motion.div
                key="stop"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <Button
                  type="button"
                  onClick={onStop}
                  variant="destructive"
                  size="icon"
                  className="h-9 w-9 rounded-xl flex-shrink-0"
                  aria-label="Stop generation"
                  title="Stop"
                >
                  <Square className="w-3.5 h-3.5" fill="currentColor" />
                </Button>
              </motion.div>
            ) : (
              <motion.div
                key="send"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <Button
                  type="button"
                  onClick={handleSend}
                  disabled={!value.trim() || disabled}
                  size="icon"
                  className="h-9 w-9 rounded-xl flex-shrink-0 bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-sm"
                  aria-label="Send message"
                  title="Send (Enter)"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Helper row */}
      <div className="flex items-center justify-between mt-1.5 px-1 text-[10px] text-muted-foreground/70">
        <span className="hidden sm:flex items-center gap-2">
          {modelMode.modelId ? (
            <span className="flex items-center gap-1">
              <Cpu className="w-2.5 h-2.5" />
              <span className="font-mono">
                {shortModelName(models.find(m => m.id === modelMode.modelId) ?? { name: '?' } as ModelOption)}
              </span>
              {modelMode.thinkingEnabled && <span className="text-purple-500">· thinking</span>}
              {modelMode.toolUseEnabled && <span className="text-cyan-500">· tools</span>}
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <Sparkles className="w-2.5 h-2.5" />
              <span>auto model</span>
            </span>
          )}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <ChevronRight className="w-2.5 h-2.5" />
          streaming in real-time
        </span>
      </div>
    </div>
  );
}

export default ChatInput;
