'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Cpu, Plus, RefreshCw, Trash2, ArrowLeft, Key, Pencil, X,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface Model {
  id: string;
  name: string;
  displayName: string;
  status: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  supportsThinking: boolean;
  supportsJsonMode: boolean;
  inputPricePer1k: string;
  outputPricePer1k: string;
  priority: number;
}

interface Provider {
  id: string;
  name: string;
  slug: string;
  type: string;
  baseUrl: string;
  status: string;
  healthStatus: string;
  hasApiKey: boolean;
  models: Model[];
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
  const [showAddModel, setShowAddModel] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [error, setError] = useState('');

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
    setError('');
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
        const errMsg = data.error?.message || 'Failed to refresh models';
        const suggestion = data.error?.suggestion || '';
        setError(`${errMsg}${suggestion ? '\n\n' + suggestion : ''}`);
      }
    } catch (err: any) {
      setError(`Network error: ${err.message}`);
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

  const handleDeleteModel = async (providerId: string, modelId: string, modelName: string) => {
    if (!confirm(`Delete model "${modelName}"?`)) return;
    const token = localStorage.getItem('accessToken');
    try {
      const res = await fetch(`/api/models/${modelId}`, {
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
        {error && (
          <Card className="mb-4 border-amber-500/30 bg-amber-500/5">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <p className="font-semibold text-sm text-amber-700 dark:text-amber-400">Refresh Models Failed</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-1">{error}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setError('')}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

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
                      <CardTitle className="flex items-center gap-2 flex-wrap">
                        {provider.name}
                        <Badge variant={provider.status === 'active' ? 'default' : 'secondary'}>
                          {provider.status}
                        </Badge>
                        {provider.hasApiKey && (
                          <Badge variant="outline" className="gap-1">
                            <Key className="w-3 h-3" /> API Key
                          </Badge>
                        )}
                        <Badge variant="outline">{provider.type}</Badge>
                      </CardTitle>
                      <CardDescription className="mt-1 font-mono text-xs">
                        {provider.baseUrl}
                      </CardDescription>
                    </div>
                    <div className="flex gap-1 flex-wrap justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRefreshModels(provider.id)}
                        disabled={refreshing === provider.id}
                      >
                        <RefreshCw className={`w-3 h-3 mr-1 ${refreshing === provider.id ? 'animate-spin' : ''}`} />
                        Auto-Discover
                      </Button>
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => setShowAddModel(provider.id)}
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        Add Model
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
                {provider.models.length > 0 ? (
                  <CardContent>
                    <div className="space-y-2">
                      {provider.models.map((model) => (
                        <div key={model.id} className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm">{model.displayName}</span>
                              <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{model.name}</code>
                              <Badge variant={model.status === 'active' ? 'default' : 'secondary'}>{model.status}</Badge>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                              <span>{(model.contextWindow / 1000).toFixed(0)}K ctx</span>
                              <span>{model.maxOutputTokens} max out</span>
                              <span>${model.inputPricePer1k}/1K in</span>
                              <span>${model.outputPricePer1k}/1K out</span>
                              {model.supportsTools && <Badge variant="outline" className="text-[10px] py-0">tools</Badge>}
                              {model.supportsVision && <Badge variant="outline" className="text-[10px] py-0">vision</Badge>}
                              {model.supportsStreaming && <Badge variant="outline" className="text-[10px] py-0">stream</Badge>}
                              {model.supportsThinking && <Badge variant="outline" className="text-[10px] py-0">thinking</Badge>}
                              {model.supportsJsonMode && <Badge variant="outline" className="text-[10px] py-0">json</Badge>}
                              <span className="text-muted-foreground/70">priority: {model.priority}</span>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteModel(provider.id, model.id, model.name)}
                            className="text-rose-500 hover:text-rose-700 hover:bg-rose-500/10"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                ) : (
                  <CardContent>
                    <div className="text-center py-6 px-4 rounded-lg border border-dashed">
                      <p className="text-sm text-muted-foreground mb-2">No models yet</p>
                      <p className="text-xs text-muted-foreground/70 mb-3">
                        Try "Auto-Discover" first. If it fails, use "Add Model" to add models manually.
                      </p>
                      <div className="flex gap-2 justify-center">
                        <Button size="sm" variant="outline" onClick={() => handleRefreshModels(provider.id)}>
                          <RefreshCw className="w-3 h-3 mr-1" /> Auto-Discover
                        </Button>
                        <Button size="sm" onClick={() => setShowAddModel(provider.id)}>
                          <Plus className="w-3 h-3 mr-1" /> Add Model Manually
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}
      </main>

      <AddProviderDialog open={showAdd} onOpenChange={setShowAdd} onSuccess={fetchProviders} />
      {showAddModel && (
        <AddModelDialog
          providerId={showAddModel}
          open={!!showAddModel}
          onOpenChange={(v) => !v && setShowAddModel(null)}
          onSuccess={fetchProviders}
        />
      )}
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
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
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

function AddModelDialog({ providerId, open, onOpenChange, onSuccess }: {
  providerId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [contextWindow, setContextWindow] = useState(8192);
  const [maxOutputTokens, setMaxOutputTokens] = useState(4096);
  const [inputPricePer1k, setInputPricePer1k] = useState(0);
  const [outputPricePer1k, setOutputPricePer1k] = useState(0);
  const [supportsTools, setSupportsTools] = useState(false);
  const [supportsVision, setSupportsVision] = useState(false);
  const [supportsStreaming, setSupportsStreaming] = useState(true);
  const [supportsThinking, setSupportsThinking] = useState(false);
  const [supportsJsonMode, setSupportsJsonMode] = useState(false);
  const [priority, setPriority] = useState(100);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const token = localStorage.getItem('accessToken');
    try {
      const res = await fetch(`/api/providers/${providerId}/models`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name,
          displayName: displayName || undefined,
          contextWindow,
          maxOutputTokens,
          inputPricePer1k,
          outputPricePer1k,
          supportsTools,
          supportsVision,
          supportsStreaming,
          supportsThinking,
          supportsJsonMode,
          priority,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed');
      onOpenChange(false);
      // Reset form
      setName(''); setDisplayName(''); setContextWindow(8192); setMaxOutputTokens(4096);
      setInputPricePer1k(0); setOutputPricePer1k(0);
      setSupportsTools(false); setSupportsVision(false); setSupportsStreaming(true);
      setSupportsThinking(false); setSupportsJsonMode(false); setPriority(100);
      onSuccess();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Model Manually</DialogTitle>
          <DialogDescription>
            Add a model to this provider. Use this when auto-discovery doesn't work or the provider doesn't list models.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm text-rose-500">{error}</p>}

          <div className="space-y-2">
            <Label htmlFor="modelName">Model Name <span className="text-rose-500">*</span></Label>
            <Input
              id="modelName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., nemotron-3-ultra-free"
              required
            />
            <p className="text-xs text-muted-foreground">
              The exact model name the provider's API expects (case-sensitive)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name (optional)</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Human-friendly name (defaults to model name)"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="contextWindow">Context Window (tokens)</Label>
              <Input
                id="contextWindow"
                type="number"
                min={1024}
                value={contextWindow}
                onChange={(e) => setContextWindow(parseInt(e.target.value) || 8192)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxOutputTokens">Max Output Tokens</Label>
              <Input
                id="maxOutputTokens"
                type="number"
                min={1}
                value={maxOutputTokens}
                onChange={(e) => setMaxOutputTokens(parseInt(e.target.value) || 4096)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="inputPrice">Input Price ($/1K tokens)</Label>
              <Input
                id="inputPrice"
                type="number"
                min={0}
                step="0.000001"
                value={inputPricePer1k}
                onChange={(e) => setInputPricePer1k(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="outputPrice">Output Price ($/1K tokens)</Label>
              <Input
                id="outputPrice"
                type="number"
                min={0}
                step="0.000001"
                value={outputPricePer1k}
                onChange={(e) => setOutputPricePer1k(parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Capabilities</Label>
            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border bg-card">
              <div className="flex items-center justify-between">
                <Label htmlFor="tools" className="text-sm cursor-pointer">Tool Calling</Label>
                <Switch id="tools" checked={supportsTools} onCheckedChange={setSupportsTools} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="vision" className="text-sm cursor-pointer">Vision</Label>
                <Switch id="vision" checked={supportsVision} onCheckedChange={setSupportsVision} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="streaming" className="text-sm cursor-pointer">Streaming</Label>
                <Switch id="streaming" checked={supportsStreaming} onCheckedChange={setSupportsStreaming} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="thinking" className="text-sm cursor-pointer">Thinking</Label>
                <Switch id="thinking" checked={supportsThinking} onCheckedChange={setSupportsThinking} />
              </div>
              <div className="flex items-center justify-between col-span-2">
                <Label htmlFor="jsonMode" className="text-sm cursor-pointer">JSON Mode</Label>
                <Switch id="jsonMode" checked={supportsJsonMode} onCheckedChange={setSupportsJsonMode} />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="priority">Priority (lower = preferred)</Label>
            <Input
              id="priority"
              type="number"
              min={1}
              max={1000}
              value={priority}
              onChange={(e) => setPriority(parseInt(e.target.value) || 100)}
            />
            <p className="text-xs text-muted-foreground">
              When multiple models are available, lower priority numbers are picked first
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading || !name}>
              {loading ? 'Adding...' : 'Add Model'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
