'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Cpu, Plus, RefreshCw, Trash2, Edit, ArrowLeft, CheckCircle2, XCircle, Key,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface Provider {
  id: string;
  name: string;
  slug: string;
  type: string;
  baseUrl: string;
  status: string;
  healthStatus: string;
  hasApiKey: boolean;
  models: Array<{
    id: string;
    name: string;
    displayName: string;
    status: string;
    contextWindow: number;
    supportsTools: boolean;
    supportsVision: boolean;
    supportsStreaming: boolean;
    inputPricePer1k: string;
    outputPricePer1k: string;
  }>;
}

const PROVIDER_TYPES = [
  { value: 'openai', label: 'OpenAI', defaultUrl: 'https://api.openai.com/v1' },
  { value: 'anthropic', label: 'Anthropic', defaultUrl: 'https://api.anthropic.com/v1' },
  { value: 'gemini', label: 'Google Gemini', defaultUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { value: 'groq', label: 'Groq', defaultUrl: 'https://api.groq.com/openai/v1' },
  { value: 'ollama', label: 'Ollama (local)', defaultUrl: 'http://localhost:11434/v1' },
  { value: 'openrouter', label: 'OpenRouter', defaultUrl: 'https://openrouter.ai/api/v1' },
  { value: 'openai_compatible', label: 'OpenAI-compatible (custom)', defaultUrl: '' },
  { value: 'custom', label: 'Custom', defaultUrl: '' },
];

export default function ProvidersPage() {
  const router = useRouter();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  const fetchProviders = async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/login'); return; }
    try {
      const res = await fetch('/api/providers', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 403) { router.push('/login'); return; }
      const data = await res.json();
      if (data.success) setProviders(data.data.providers);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchProviders(); }, []);

  const handleRefreshModels = async (providerId: string) => {
    setRefreshing(providerId);
    const token = localStorage.getItem('accessToken');
    try {
      const res = await fetch(`/api/providers/${providerId}/refresh-models`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        alert(`✓ Added ${data.data.added} new models, updated ${data.data.updated}`);
        fetchProviders();
      } else {
        alert(`✗ ${data.error?.message}`);
      }
    } catch (err: any) {
      alert(`✗ ${err.message}`);
    } finally {
      setRefreshing(null);
    }
  };

  const handleDelete = async (providerId: string, name: string) => {
    if (!confirm(`Delete provider "${name}"? This will also delete all its models.`)) return;
    const token = localStorage.getItem('accessToken');
    try {
      const res = await fetch(`/api/providers/${providerId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) fetchProviders();
    } catch (err) {
      console.error(err);
    }
  };

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
            <h1 className="text-lg font-bold">Providers</h1>
          </div>
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="w-4 h-4 mr-1" /> Add Provider
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        {providers.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Cpu className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-lg font-semibold mb-1">No providers yet</p>
              <p className="text-sm text-muted-foreground mb-4">Add your first LLM provider to start chatting</p>
              <Button onClick={() => setShowAdd(true)}>
                <Plus className="w-4 h-4 mr-1" /> Add Provider
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {providers.map((provider) => (
              <Card key={provider.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        {provider.name}
                        <Badge variant={provider.status === 'active' ? 'default' : 'secondary'}>
                          {provider.status}
                        </Badge>
                        {provider.hasApiKey && (
                          <Badge variant="outline" className="gap-1">
                            <Key className="w-3 h-3" /> API Key
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {provider.type} · {provider.baseUrl} · {provider.models.length} models
                      </CardDescription>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRefreshModels(provider.id)}
                        disabled={refreshing === provider.id}
                      >
                        <RefreshCw className={`w-3 h-3 mr-1 ${refreshing === provider.id ? 'animate-spin' : ''}`} />
                        Refresh Models
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDelete(provider.id, provider.name)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {provider.models.length > 0 && (
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {provider.models.map((model) => (
                        <div key={model.id} className="flex items-center justify-between p-2 rounded border text-sm">
                          <div>
                            <span className="font-medium">{model.displayName}</span>
                            <span className="text-xs text-muted-foreground ml-2">
                              {model.contextWindow > 0 ? `${(model.contextWindow / 1000).toFixed(0)}K ctx` : ''}
                              {model.supportsTools && ' · tools'}
                              {model.supportsVision && ' · vision'}
                              {model.supportsStreaming && ' · stream'}
                            </span>
                          </div>
                          <Badge variant={model.status === 'active' ? 'default' : 'secondary'}>
                            {model.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}
      </main>

      <AddProviderDialog open={showAdd} onOpenChange={setShowAdd} onSuccess={fetchProviders} />
    </div>
  );
}

function AddProviderDialog({ open, onOpenChange, onSuccess }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [type, setType] = useState('openai');
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleTypeChange = (newType: string) => {
    setType(newType);
    const providerType = PROVIDER_TYPES.find(p => p.value === newType);
    if (providerType?.defaultUrl) setBaseUrl(providerType.defaultUrl);
    if (!slug || slug === 'new-provider') {
      setSlug(newType + '-' + Math.random().toString(36).slice(2, 6));
    }
    if (!name) setName(providerType?.label || newType);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const token = localStorage.getItem('accessToken');
    try {
      const res = await fetch('/api/providers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name, slug, type, baseUrl, apiKey }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed');
      onOpenChange(false);
      setName(''); setSlug(''); setApiKey('');
      onSuccess();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Provider</DialogTitle>
          <DialogDescription>Configure a new LLM provider</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm text-rose-500">{error}</p>}
          <div className="space-y-2">
            <Label>Provider Type</Label>
            <Select value={type} onValueChange={handleTypeChange}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PROVIDER_TYPES.map(p => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Display Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="slug">Slug (lowercase, no spaces)</Label>
            <Input id="slug" value={slug} onChange={(e) => setSlug(e.target.value)} required pattern="[a-z0-9-]+" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="baseUrl">Base URL</Label>
            <Input id="baseUrl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="apiKey">API Key (optional for Ollama)</Label>
            <Input id="apiKey" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Adding...' : 'Add Provider'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
