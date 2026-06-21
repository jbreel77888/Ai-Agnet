# Manus-style Chat Interface — Implementation Record

**Task ID**: manus-chat-ui
**Agent**: main (Z.ai Code)
**Date**: 2026-06-21

## Summary

Replaced the existing simple chat page with a complete Manus-style chat
experience: full-width layout with dark sidebar, streaming SSE messages
with markdown rendering, collapsible "Thinking Process" reasoning
timeline, expandable tool-call cards, tabbed artifact viewer with syntax
highlighting, multi-step task timeline, stop/regenerate controls, mobile
sheet drawer, and per-agent color coding.

All new files pass `bun run lint` and `bunx tsc --noEmit --skipLibCheck`
with zero errors or warnings (pre-existing errors in unrelated files are
unchanged).

## Files Created (8 new)

| # | Path | Purpose |
|---|------|---------|
| 1 | `src/lib/agent-types.ts` | Agent type → color/icon/label mapping for all 9 agent types (Planner=purple, Research=sky, Reasoning=emerald, Coding=amber, Execution=rose, Tool=cyan, Memory=indigo, Reflection=orange, Summarizer=slate) |
| 2 | `src/components/chat/MarkdownRenderer.tsx` | GitHub-flavored markdown (`react-markdown` + `remark-gfm`) with Prism syntax highlighting, per-block copy button, responsive tables/images, safe link targets |
| 3 | `src/components/chat/ThinkingProcess.tsx` | Collapsible reasoning timeline panel — animated step icons (Analyzing → Searching → Tool → Synthesizing → Responding), auto-expand on running, auto-collapse 1.2s after completion, total duration badge |
| 4 | `src/components/chat/ToolCallCard.tsx` | Expandable tool-call card — running/success/error/pending states with colored borders, collapsible Arguments + Result sections, duration badge, JSON pretty-printing |
| 5 | `src/components/chat/ArtifactViewer.tsx` | Tabbed artifact viewer — supports code/text/json/image artifacts, Prism highlighting (auto-detected language from filename), per-tab copy & download buttons, Blob-URL download for any content |
| 6 | `src/components/chat/TaskTimeline.tsx` | Multi-step task progress — overall progress bar, vertical stepper with sub-steps (typically tool calls), per-step duration, status badges |
| 7 | `src/components/chat/MessageBubble.tsx` | Single message row — handles user/assistant/tool_call/tool_result/error/system roles, agent-colored avatar with type-icon, streaming caret, copy message, metadata footer (tokens/cost/duration/model) |
| 8 | `src/components/chat/ChatSidebar.tsx` | Left-hand dark sidebar — brand, back-to-dashboard, agent picker, New Chat button, searchable sessions list with agent color dots + relative timestamps, mobile Sheet drawer |

## Files Modified (1)

| # | Path | Change |
|---|------|--------|
| 1 | `src/app/admin/chat/page.tsx` | **Complete rewrite** — Manus-style 3-pane layout assembling all the new components with full SSE event handling |

## Dependencies Added

- `remark-gfm@4.0.1` — for GitHub-flavored markdown tables, strikethrough, task lists
- (Existing) `react-markdown`, `react-syntax-highlighter` — already in `package.json`

## SSE Event Handling

The chat page parses the streaming response from
`POST /api/sessions/[id]/messages` and maps each event type to UI updates:

| SSE Event | UI Effect |
|-----------|-----------|
| `started` | Add "Analyzing request" thinking step (running) |
| `thinking` | Add info thinking step with content snippet |
| `message_chunk` | Append to assistant message content; complete `analyzing` step; start `synthesizing` step |
| `tool_call` | Complete `synthesizing` step; add `tool` thinking step "Running {name}"; add new ToolCallCard (running) |
| `tool_result` | Complete matching `tool` thinking step with durationMs; re-open `synthesizing` step; update matching ToolCallCard with result + duration + success status |
| `handoff_request` | Add info thinking step "Handing off to {target}" |
| `subagent_spawned` | Add analyzing thinking step "Spawned {type} subagent" |
| `completed` | Mark all running thinking steps completed; set metadata (tokensUsed, cost, durationMs); clear `isStreaming` |
| `error` | Mark running steps failed; append error message to content; set `isError` |
| `cancelled` | Mark running steps failed (detail: "cancelled"); append "_(cancelled)_" |
| `message_saved` | Replace temp assistant ID with real DB ID; refresh sessions list |
| `[DONE]` | End of stream |

## Features

### Layout
- **3-pane**: dark sidebar (sessions) | chat header + scrollable messages | sticky input footer
- **Mobile-responsive**: sidebar collapses to a Sheet drawer; chat header compacts; stats hide on small screens
- **Sticky behavior**: header stays at top, input stays at bottom, messages scroll independently

### Messaging
- **User bubbles**: emerald gradient, right-aligned
- **Assistant messages**: card-style with agent-colored avatar, type badge, "generating…" indicator
- **Markdown**: full GFM rendering (tables, lists, code blocks, links open in new tab)
- **Code blocks**: Prism one-dark theme with per-block copy button and language label
- **Copy message button** in assistant message footer
- **Streaming caret**: blinking emerald block at end of content while streaming
- **Metadata footer**: model badge, token count, cost, duration

### Real-time Feedback
- **Thinking Process**: collapsible gray panel above each assistant message showing vertical timeline of steps (analyzing → synthesizing → running tools → synthesizing → responding), with auto-expand on running and auto-collapse 1.2s after completion
- **ToolCallCard**: each tool invocation shows as an expandable card with amber/emerald/rose accent for running/success/error states; collapsible Arguments and Result sections with JSON pretty-printing; duration badge
- **Stop button**: replaces Send while streaming; uses `AbortController` to cancel the in-flight fetch; on abort, marks the message "_(stopped by user)_"
- **Regenerate**: header button that removes the trailing assistant message and re-sends the last user prompt
- **Auto-scroll**: stick-to-bottom behavior — auto-scrolls only if user is within 80px of bottom; otherwise stays put (so users can scroll back to read while streaming continues)

### Sessions
- **Sidebar list**: most-recent-first, agent color dot, title, agent name, relative timestamp, message count badge
- **Search**: filter sessions by title or agent name (case-insensitive)
- **New Chat**: agent picker + button; auto-loads new session
- **Delete session**: hover trash button with confirmation prompt
- **Session stats in header**: message count, total tokens (formatted as k/M), total cost (USD)

### Empty States
- **No session selected**: gradient icon, headline, 4 suggestion chips that auto-create a session and send
- **Empty conversation**: muted bot icon + "Send a message to begin"
- **Loading state**: full-screen spinner with "Loading chat…"
- **Error banner**: rose-tinted banner below header with dismiss button

### Input
- **Auto-growing textarea**: 44px min, 160px max height
- **Send/Stop button**: gradient emerald Send icon; rose Stop icon while streaming
- **Keyboard**: Enter to send, Shift+Enter for newline
- **Helper text**: agent name + "Responses stream in real-time"

## Auth Pattern (unchanged)
- `localStorage.getItem('accessToken')` on mount
- Redirect to `/login` if missing or if API returns 401

## Code Quality

```
$ bun run lint
# 0 errors, 0 warnings in any of the new files
# (28 pre-existing errors in unrelated files: orchestrator, api/health,
#  embedded-postgres, tools/builtin, providers/manager — all out of scope)

$ bunx tsc --noEmit --skipLibCheck
# 0 errors in any of the new files
# (Pre-existing errors in src/types/index.ts:233 (duplicate `type` field in
#  AgentEvent — same bug I fixed locally in my SSEEvent union) and other
#  files are unchanged and out of scope.)
```

## Dev Server Verification

Ran `bun run dev` briefly to confirm:
- `GET /admin/chat` returns **HTTP 200** (compiles cleanly in 5.0s on first hit)
- No errors in dev log related to the chat page
- (Pre-existing `ECONNREFUSED` on the login route is unrelated — embedded PG
  connection timing issue at startup; not my code)

## Patterns Reused from Existing Code

- `localStorage.getItem('accessToken')` auth pattern — matches `providers/page.tsx`, `users/page.tsx`, etc.
- Dark sidebar aesthetic — matches the existing dashboard header gradient
- shadcn/ui components: `Button`, `Badge`, `Textarea`, `ScrollArea`, `Sheet`, `Select`, `Tooltip`, `Collapsible`, `Tabs`, `Progress`
- `lucide-react` icons throughout
- `framer-motion`-style transitions via Tailwind (no extra deps needed)
- Functional setState updates to avoid `react-hooks/exhaustive-deps` lint errors
- `setTimeout`-wrapped setState in effects to satisfy `react-hooks/set-state-in-effect` rule

## Notes for Downstream Agents

- The `ThinkingProcess` component manages its own open/closed state via a ref-tracked transition pattern. If you need to control it externally, lift the state up and pass `defaultOpen` + adjust the auto-collapse effect.
- The `MarkdownRenderer` uses Prism's `oneDark` theme — switch via the import in `MarkdownRenderer.tsx` and `ArtifactViewer.tsx`.
- The `ArtifactViewer` download function uses `Blob` + `URL.createObjectURL` for text/code/json; for images it fetches the data URL or opens remote URLs in a new tab.
- All agent color/icon mappings live in `src/lib/agent-types.ts` — extend `AGENT_TYPE_STYLES` if new agent types are added.
- The chat page's SSE handler is one big switch statement inside `sendMessage()`. Each case updates the assistant message immutably via `updateAssistant()`. If you need to add a new event type, add a case and update the `SSEEvent` union type at the top of the file.
- Tool result matching is by tool name + running status (the most recent matching call). If a tool is called twice in sequence without results arriving between, this could match the wrong one. A more robust matching would use `toolCallId`, but the backend `tool_result` event currently doesn't include it.
