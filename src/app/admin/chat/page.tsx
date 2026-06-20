'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Send, ArrowLeft, RefreshCw, User, Bot, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Model {
  id: string;
  name: string;
  displayName: string;
  providerName: string;
  providerSlug: string;
  contextWindow: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  streaming?: boolean;
}

export default function ChatPage() {
  const router = useRouter();
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingModels, setLoadingModels] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchModels = async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/login'); return; }
    try {
      const res = await fetch('/api/models', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setModels(data.data.models);
        if (data.data.models.length > 0 && !selectedModel) {
          setSelectedModel(data.data.models[0].id);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => { fetchModels(); }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !selectedModel || loading) return;

    const userMessage: Message = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    // Add placeholder for assistant response
    const assistantIndex = newMessages.length;
    setMessages([...newMessages, { role: 'assistant', content: '', streaming: true }]);

    const token = localStorage.getItem('accessToken');
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          modelId: selectedModel,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          stream: false,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setMessages(prev => {
          const updated = [...prev];
          updated[assistantIndex] = {
            role: 'assistant',
            content: data.data.content || '(no response)',
            streaming: false,
          };
          return updated;
        });
      } else {
        setMessages(prev => {
          const updated = [...prev];
          updated[assistantIndex] = {
            role: 'assistant',
            content: `Error: ${data.error?.message || 'Failed'}`,
            streaming: false,
          };
          return updated;
        });
      }
    } catch (err: any) {
      setMessages(prev => {
        const updated = [...prev];
        updated[assistantIndex] = {
          role: 'assistant',
          content: `Network error: ${err.message}`,
          streaming: false,
        };
        return updated;
      });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex flex-col">
      {/* Header */}
      <header className="border-b bg-white/80 dark:bg-slate-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => router.push('/admin')}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <h1 className="text-lg font-bold">Chat</h1>
          </div>
          <div className="flex items-center gap-2">
            {loadingModels ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : models.length === 0 ? (
              <Badge variant="destructive">No models — add a provider first</Badge>
            ) : (
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {models.map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.displayName} ({m.providerName})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 container mx-auto px-4 py-6 max-w-3xl overflow-y-auto">
        {messages.length === 0 ? (
          <div className="text-center py-12">
            <Bot className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-lg font-semibold mb-1">Start a conversation</p>
            <p className="text-sm text-muted-foreground">
              {models.length === 0
                ? 'Add a provider and refresh models in the Providers page first'
                : 'Type a message below to chat with the selected model'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white flex-shrink-0">
                    <Bot className="w-4 h-4" />
                  </div>
                )}
                <div className={`max-w-[80%] rounded-lg p-3 ${
                  msg.role === 'user'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-white dark:bg-slate-900 border'
                }`}>
                  <p className="text-sm whitespace-pre-wrap">
                    {msg.content}
                    {msg.streaming && <Loader2 className="w-3 h-3 inline ml-1 animate-spin" />}
                  </p>
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
      </main>

      {/* Input */}
      <footer className="border-t bg-white/80 dark:bg-slate-950/80 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4 max-w-3xl">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={models.length === 0 ? 'Add a provider first to start chatting...' : 'Type a message... (Enter to send, Shift+Enter for newline)'}
              disabled={loading || models.length === 0}
              rows={1}
              className="min-h-[44px] max-h-32 resize-none"
            />
            <Button onClick={handleSend} disabled={!input.trim() || loading || models.length === 0}>
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}
