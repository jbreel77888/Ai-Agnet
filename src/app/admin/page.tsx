'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bot, Cpu, Boxes, Activity, LogOut, ExternalLink,
  Server, Shield, CheckCircle2, XCircle, RefreshCw,
  Wrench, FileText,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface User {
  id: string;
  email: string;
  name?: string;
  roles: string[];
}

interface Health {
  status: string;
  checks: Array<{ name: string; status: string; details?: any }>;
  uptime: number;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    const userStr = localStorage.getItem('user');

    if (!token || !userStr) {
      router.push('/login');
      return;
    }

    setUser(JSON.parse(userStr));

    // Fetch health
    fetch('/api/health')
      .then(r => r.json())
      .then(d => setHealth(d.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [router]);

  const handleLogout = async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    }
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    router.push('/login');
  };

  if (!user) return null;

  const adminCards = [
    { title: 'Providers', desc: 'Manage LLM providers and API keys', icon: Cpu, href: '/admin/providers', color: 'text-emerald-500' },
    { title: 'Agents', desc: 'Configure AI agents and their prompts', icon: Bot, href: '/admin/agents', color: 'text-blue-500' },
    { title: 'Chat', desc: 'Chat with agents — streaming + tools', icon: Activity, href: '/admin/chat', color: 'text-purple-500' },
    { title: 'Tools', desc: 'Built-in tools (calculator, web search, memory, HTTP)', icon: Wrench, href: '/admin/tools', color: 'text-amber-500' },
    { title: 'Documents', desc: 'Upload documents for RAG semantic search', icon: FileText, href: '/admin/documents', color: 'text-cyan-500' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      {/* Header */}
      <header className="border-b bg-white/80 dark:bg-slate-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold">Agent Platform Admin</h1>
              <p className="text-xs text-muted-foreground">Phase 2 — Core Implementation</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium">{user.name || user.email}</p>
              <p className="text-xs text-muted-foreground">{user.roles.join(', ')}</p>
            </div>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="w-4 h-4 mr-1" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Health status */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="w-5 h-5 text-emerald-500" />
              System Health
            </CardTitle>
            <CardDescription>Real-time status of all platform components</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="w-4 h-4 animate-spin" />
                Loading...
              </div>
            ) : health ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {health.checks.map((check) => (
                  <div key={check.name} className="flex items-center gap-2">
                    {check.status === 'healthy' ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    ) : check.status === 'degraded' ? (
                      <AlertCircle className="w-5 h-5 text-amber-500" />
                    ) : (
                      <XCircle className="w-5 h-5 text-rose-500" />
                    )}
                    <div>
                      <p className="text-sm font-medium capitalize">{check.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {check.status}
                        {check.name === 'database' && check.details?.tables ? ` · ${check.details.tables} tables` : ''}
                        {check.name === 'redis' && check.details?.mode ? ` · ${check.details.mode}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Failed to load health status</p>
            )}
          </CardContent>
        </Card>

        {/* Admin sections */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
          {adminCards.map((card) => (
            <Card key={card.title} className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => router.push(card.href)}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                    <card.icon className={`w-5 h-5 ${card.color}`} />
                  </div>
                  <div>
                    <CardTitle className="text-base">{card.title}</CardTitle>
                    <CardDescription className="text-xs">{card.desc}</CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>

        {/* Quick links */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Quick Links</CardTitle>
            <CardDescription>External resources and tools</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <a href="/api/health" target="_blank" className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4" />
                <span className="text-sm">API Health Check</span>
              </div>
              <ExternalLink className="w-4 h-4 text-muted-foreground" />
            </a>
            <a href="/api/providers" target="_blank" className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4" />
                <span className="text-sm">Providers API</span>
              </div>
              <ExternalLink className="w-4 h-4 text-muted-foreground" />
            </a>
            <a href="/api/models" target="_blank" className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2">
                <Boxes className="w-4 h-4" />
                <span className="text-sm">Models API</span>
              </div>
              <ExternalLink className="w-4 h-4 text-muted-foreground" />
            </a>
            <a href="/api/agents" target="_blank" className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4" />
                <span className="text-sm">Agents API</span>
              </div>
              <ExternalLink className="w-4 h-4 text-muted-foreground" />
            </a>
          </CardContent>
        </Card>

        <footer className="text-center text-xs text-muted-foreground mt-8">
          <p>Agent Platform · Phase 2 · <Badge variant="outline" className="ml-1">Production</Badge></p>
        </footer>
      </main>
    </div>
  );
}

function AlertCircle({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
