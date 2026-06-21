'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Send, ArrowLeft, RefreshCw, User, Bot, Loader2, Plus, MessageSquare, Trash2, Bot as BotIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Agent { id: string; name: string; slug: string; type: string; description: string | null; }
interface Session { id: string; agentName: string; title: string; status: string; lastActivityAt: string; }
interface Message { id: string; role: string; content: string; createdAt: string; }

export default function ChatPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSession, setCurrentSession] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [error, setError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

  useEffect(() => {
    if (!token) { router.push('/login'); return; }
    Promise.all([
      fetch('/api/agents', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      fetch('/api/sessions', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    ]).then(([agentsData, sessionsData]) => {
      if (agentsData.success) {
        setAgents(agentsData.data.agents);
        if (agentsData.data.agents.length > 0) setSelectedAgent(agentsData.data.agents[0].slug);
      }
      if (sessionsData.success) setSessions(sessionsData.data.sessions);
    }).catch(console.error).finally(() => setLoadingData(false));
  }, [router, token]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadSession = async (sessionId: string) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.success) {
        setCurrentSession(sessionId);
        setMessages(data.data.messages || []);
      }
    } catch (err) { console.error(err); }
  };

  const createSession = async () => {
    if (!token || !selectedAgent) return;
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ agentSlug: selectedAgent }),
      });
      const data = await res.json();
      if (data.success) {
        // Refresh sessions list
        const sRes = await fetch('/api/sessions', { headers: { Authorization: `Bearer ${token}` } });
        const sData = await sRes.json();
        if (sData.success) setSessions(sData.data.sessions);
        await loadSession(data.data.sessionId);
      }
    } catch (err: any) { setError(err.message); }
  };

  const handleSend = async () => {
    if (!input.trim() || !currentSession || loading) return;
    const userMessage = { id: 'temp-' + Date.now(), role: 'user', content: input.trim(), createdAt: new Date().toISOString() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    setError('');

    // Add placeholder for assistant
    const assistantId = 'temp-assistant-' + Date.now();
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', createdAt: new Date().toISOString() }]);

    abortRef.current = new AbortController();

    try {
      const response = await fetch(`/api/sessions/${currentSession}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: userMessage.content }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const event = JSON.parse(data);
            if (event.type === 'message_chunk') {
              assistantContent += event.content;
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: assistantContent } : m));
            } else if (event.type === 'error') {
              setError(event.error?.message || 'Agent error');
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: `⚠️ Error: ${event.error?.message}` } : m));
            } else if (event.type === 'message_saved') {
              // Update the assistant message with the real ID
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, id: event.messageId } : m));
            }
          } catch {}
        }
      }

      if (!assistantContent) {
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: '(No response received)' } : m));
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message);
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: `⚠️ Error: ${err.message}` } : m));
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const handleStop = () => { abortRef.current?.abort(); setLoading(false); };

  const deleteSession = async (sessionId: string) => {
    if (!confirm('Delete this session?')) return;
    try {
      await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (currentSession === sessionId) { setCurrentSession(null); setMessages([]); }
      // Refresh
      const res = await fetch('/api/sessions', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.success) setSessions(data.data.sessions);
    } catch (err) { console.error(err); }
  };

  if (loadingData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex">
      {/* Sidebar — sessions list */}
      <aside className="w-72 border-r bg-white/80 dark:bg-slate-950/80 backdrop-blur-sm flex flex-col">
        <div className="p-4 border-b">
          <Button variant="ghost" size="sm" onClick={() => router.push('/admin')} className="mb-3">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <h2 className="text-sm font-semibold mb-2">New Session</h2>
          <div className="space-y-2">
            <Select value={selectedAgent} onValueChange={setSelectedAgent}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select agent" /></SelectTrigger>
              <SelectContent>
                {agents.map(a => <SelectItem key={a.slug} value={a.slug}>{a.name} ({a.type})</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={createSession} className="w-full" size="sm" disabled={!selectedAgent}>
              <Plus className="w-3 h-3 mr-1" /> New Chat
            </Button>
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {sessions.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center p-4">No sessions yet</p>
            ) : (
              sessions.map(s => (
                <div key={s.id} className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer hover:bg-accent/50 transition-colors group ${currentSession === s.id ? 'bg-accent' : ''}`} onClick={() => loadSession(s.id)}>
                  <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{s.title}</p>
                    <p className="text-[10px] text-muted-foreground">{new Date(s.lastActivityAt).toLocaleDateString()}</p>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }} className="opacity-0 group-hover:opacity-100 text-rose-500 hover:text-rose-700">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </aside>

      {/* Main chat area */}
      <main className="flex-1 flex flex-col">
        {/* Header */}
        <header className="border-b bg-white/80 dark:bg-slate-950/80 backdrop-blur-sm px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BotIcon className="w-5 h-5 text-emerald-500" />
            <h1 className="text-lg font-bold">Agent Chat</h1>
            {currentSession && <Badge variant="outline">{sessions.find(s => s.id === currentSession)?.agentName || 'agent'}</Badge>}
          </div>
          {error && <p className="text-xs text-rose-500">{error}</p>}
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4">
          {!currentSession ? (
            <div className="text-center py-12">
              <BotIcon className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-lg font-semibold mb-1">Start a conversation</p>
              <p className="text-sm text-muted-foreground">Select an agent and click "New Chat" to begin</p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-4">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white flex-shrink-0">
                      <Bot className="w-4 h-4" />
                    </div>
                  )}
                  <div className={`max-w-[80%] rounded-lg p-3 ${msg.role === 'user' ? 'bg-emerald-500 text-white' : 'bg-white dark:bg-slate-900 border'}`}>
                    <p className="text-sm whitespace-pre-wrap">{msg.content || <Loader2 className="w-3 h-3 inline animate-spin" />}</p>
                  </div>
                  {msg.role === 'user' && (
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4" />
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        {currentSession && (
          <footer className="border-t bg-white/80 dark:bg-slate-950/80 backdrop-blur-sm p-4">
            <div className="max-w-3xl mx-auto flex gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
                disabled={loading}
                rows={1}
                className="min-h-[44px] max-h-32 resize-none"
              />
              {loading ? (
                <Button onClick={handleStop} variant="destructive">
                  <span className="w-3 h-3 rounded-sm bg-current" />
                </Button>
              ) : (
                <Button onClick={handleSend} disabled={!input.trim()}>
                  <Send className="w-4 h-4" />
                </Button>
              )}
            </div>
          </footer>
        )}
      </main>
    </div>
  );
}
