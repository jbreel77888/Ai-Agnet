'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, ArrowLeft, RefreshCw, Plus } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Agent {
  id: string;
  name: string;
  slug: string;
  type: string;
  description: string | null;
  systemPrompt: string | null;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
  canSpawnSubagents: boolean;
  maxSubagents: number;
  handoffTargets: string[] | null;
}

const AGENT_TYPE_COLORS: Record<string, string> = {
  planner: 'bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30',
  research: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30',
  reasoning: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  coding: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  execution: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30',
  tool: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/30',
  memory: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 border-indigo-500/30',
  reflection: 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30',
  summarizer: 'bg-slate-500/15 text-slate-700 dark:text-slate-400 border-slate-500/30',
  custom: 'bg-gray-500/15 text-gray-700 dark:text-gray-400 border-gray-500/30',
};

export default function AgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchAgents = async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/login'); return; }
    try {
      const res = await fetch('/api/agents', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) setAgents(data.data.agents);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAgents(); }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <header className="border-b bg-white/80 dark:bg-slate-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => router.push('/admin')}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <h1 className="text-lg font-bold">Agents</h1>
            <Badge variant="outline">{agents.length} agents</Badge>
          </div>
          <Button onClick={() => alert('Custom agent creation will be available in Phase 3')}>
            <Plus className="w-4 h-4 mr-1" /> New Agent
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="space-y-3">
          {agents.map((agent) => (
            <Card key={agent.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setExpanded(expanded === agent.id ? null : agent.id)}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white">
                      <Bot className="w-5 h-5" />
                    </div>
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        {agent.name}
                        <Badge variant="outline" className={AGENT_TYPE_COLORS[agent.type] || AGENT_TYPE_COLORS.custom}>
                          {agent.type}
                        </Badge>
                        {!agent.enabled && <Badge variant="secondary">disabled</Badge>}
                      </CardTitle>
                      <CardDescription className="text-xs mt-1">{agent.description || 'No description'}</CardDescription>
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p>temp: {agent.temperature}</p>
                    <p>max tokens: {agent.maxTokens}</p>
                    {agent.canSpawnSubagents && <p className="text-emerald-600">can spawn subagents ({agent.maxSubagents})</p>}
                  </div>
                </div>
              </CardHeader>
              {expanded === agent.id && agent.systemPrompt && (
                <CardContent>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground">System Prompt:</p>
                    <pre className="text-xs bg-muted p-3 rounded-lg whitespace-pre-wrap max-h-96 overflow-y-auto">
                      {agent.systemPrompt}
                    </pre>
                    {agent.handoffTargets && agent.handoffTargets.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mt-2">Handoff Targets:</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {agent.handoffTargets.map(t => (
                            <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
