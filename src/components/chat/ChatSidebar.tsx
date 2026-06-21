'use client';

/**
 * ChatSidebar — left-hand panel with:
 *   - Back-to-dashboard link
 *   - Agent picker + "New Chat" button
 *   - Searchable sessions list (most recent first)
 *   - Per-session: agent color dot, title, last-activity timestamp, delete btn
 *   - Mobile-friendly: parent passes `mobileOpen` + `onMobileOpenChange`;
 *     on `lg+` screens the sidebar is a static aside; below that it slides
 *     in as a Sheet.
 *
 * The component is purely presentational — all state lives in the parent page.
 */
import { useState, useMemo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Plus, MessageSquare, Trash2, Search, Bot, X, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { getAgentTypeStyle } from '@/lib/agent-types';

export interface SidebarAgent {
  id: string;
  name: string;
  slug: string;
  type: string;
  description?: string | null;
}

export interface SidebarSession {
  id: string;
  agentName: string;
  agentSlug?: string;
  agentType?: string;
  title: string;
  status: string;
  lastActivityAt: string;
  messageCount?: number;
  totalTokens?: number;
}

interface ChatSidebarProps {
  agents: SidebarAgent[];
  sessions: SidebarSession[];
  selectedAgent: string;
  currentSessionId: string | null;
  loading?: boolean;
  onSelectAgent: (slug: string) => void;
  onCreateSession: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  /** Mobile drawer open state (controlled). */
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

function relativeTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = now - d.getTime();
    const min = Math.floor(diff / 60_000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}d ago`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

interface SidebarBodyProps extends Omit<ChatSidebarProps, 'mobileOpen' | 'onMobileOpenChange'> {
  query: string;
  setQuery: (q: string) => void;
  onNavigate?: () => void;
}

function SidebarBody({
  agents, sessions, selectedAgent, currentSessionId, loading,
  onSelectAgent, onCreateSession, onSelectSession, onDeleteSession,
  query, setQuery, onNavigate,
}: SidebarBodyProps) {
  const router = useRouter();

  const filteredSessions = useMemo(() => {
    if (!query.trim()) return sessions;
    const q = query.toLowerCase();
    return sessions.filter(s =>
      s.title.toLowerCase().includes(q) ||
      (s.agentName || '').toLowerCase().includes(q)
    );
  }, [sessions, query]);

  const handleBack = () => { onNavigate?.(); router.push('/admin'); };
  const handleCreate = () => { onCreateSession(); onNavigate?.(); };
  const handleSelect = (id: string) => { onSelectSession(id); onNavigate?.(); };

  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-100">
      {/* Top: brand + back */}
      <div className="px-4 pt-4 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <Bot className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-semibold">Agent Chat</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          className="w-full justify-start text-slate-300 hover:text-white hover:bg-slate-800"
        >
          <ArrowLeft className="w-3.5 h-3.5 mr-2" />
          Back to Dashboard
        </Button>
      </div>

      {/* New chat section */}
      <div className="px-4 py-3 border-b border-slate-800 space-y-2">
        <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">
          New Session
        </label>
        <Select value={selectedAgent} onValueChange={onSelectAgent}>
          <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-100">
            <SelectValue placeholder="Select agent…" />
          </SelectTrigger>
          <SelectContent>
            {agents.length === 0 ? (
              <SelectItem value="_none" disabled>No agents available</SelectItem>
            ) : (
              agents.map(a => (
                <SelectItem key={a.slug} value={a.slug}>
                  <span className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ background: getAgentTypeStyle(a.type).hex }}
                    />
                    {a.name}
                    <span className="text-[10px] text-muted-foreground uppercase">{a.type}</span>
                  </span>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        <Button
          onClick={handleCreate}
          disabled={!selectedAgent || selectedAgent === '_none' || loading}
          className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white"
          size="sm"
        >
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          New Chat
        </Button>
      </div>

      {/* Search */}
      <div className="px-4 py-2 border-b border-slate-800">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats…"
            className="h-8 pl-8 pr-7 bg-slate-900 border-slate-700 text-slate-100 placeholder:text-slate-500 text-[12px]"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              aria-label="Clear search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Sessions list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-2 py-2 space-y-0.5">
          {filteredSessions.length === 0 ? (
            <div className="px-3 py-10 text-center">
              <Sparkles className="w-6 h-6 text-slate-600 mx-auto mb-2" />
              <p className="text-[12px] text-slate-500">
                {query ? 'No matches found' : 'No chats yet'}
              </p>
              {!query && (
                <p className="text-[10px] text-slate-600 mt-1">
                  Pick an agent above to start
                </p>
              )}
            </div>
          ) : (
            filteredSessions.map(s => {
              const style = getAgentTypeStyle(s.agentType);
              const isActive = currentSessionId === s.id;
              return (
                <div
                  key={s.id}
                  onClick={() => handleSelect(s.id)}
                  className={`group relative flex items-start gap-2 px-2.5 py-2 rounded-md cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-slate-800 ring-1 ring-slate-700'
                      : 'hover:bg-slate-900'
                  }`}
                >
                  <span
                    className="mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: style.hex }}
                    aria-hidden
                  />
                  <MessageSquare className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${isActive ? 'text-emerald-400' : 'text-slate-500'}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-[12px] truncate ${isActive ? 'text-white font-medium' : 'text-slate-200'}`}>
                      {s.title}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] text-slate-500 truncate">
                        {s.agentName}
                      </span>
                      <span className="text-slate-700">·</span>
                      <span className="text-[10px] text-slate-500 flex-shrink-0">
                        {relativeTime(s.lastActivityAt)}
                      </span>
                      {s.messageCount !== undefined && s.messageCount > 0 && (
                        <Badge variant="secondary" className="text-[9px] h-3.5 px-1 ml-auto bg-slate-800 text-slate-400">
                          {s.messageCount}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteSession(s.id); }}
                    className="absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-100 p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-all"
                    aria-label="Delete session"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-slate-800 text-[10px] text-slate-600">
        {sessions.length} session{sessions.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

export function ChatSidebar(props: ChatSidebarProps): ReactNode {
  const [query, setQuery] = useState('');
  const { mobileOpen, onMobileOpenChange, ...rest } = props;

  return (
    <>
      {/* Desktop static sidebar */}
      <aside className="hidden lg:flex w-72 flex-shrink-0 border-r border-slate-200 dark:border-slate-800">
        <SidebarBody {...rest} query={query} setQuery={setQuery} />
      </aside>

      {/* Mobile sheet */}
      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent side="left" className="w-[300px] p-0 border-0">
          <SheetTitle className="sr-only">Chat sessions</SheetTitle>
          <SidebarBody
            {...rest}
            query={query}
            setQuery={setQuery}
            onNavigate={() => onMobileOpenChange(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
