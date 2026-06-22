'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, RefreshCw, DollarSign, Zap, Activity, Plus,
  Trash2, Pencil, TrendingUp, Target, AlertTriangle, X,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

interface CostSummary {
  totalCost: number;
  totalTokens: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  requestCount: number;
  currency: string;
  range: { from: string; to: string };
  daily: Array<{ date: string; cost: number; tokensInput: number; tokensOutput: number; tokens: number; count: number }>;
}

interface Breakdown {
  byModel: Array<{ modelId: string | null; modelName: string; cost: number; tokensInput: number; tokensOutput: number; tokens: number; count: number }>;
  byProvider: Array<{ providerId: string | null; providerName: string; providerType: string; cost: number; tokens: number; count: number }>;
  byUser: Array<{ userId: string | null; userEmail: string; userName: string | null; cost: number; tokens: number; count: number }>;
}

interface Budget {
  id: string;
  userId: string | null;
  scope: 'user' | 'session' | 'agent' | 'global';
  scopeId: string | null;
  period: 'daily' | 'weekly' | 'monthly' | 'total';
  limitUsd: number;
  spentUsd: number;
  resetAt: string | null;
  action: 'warn' | 'block' | 'notify';
  enabled: boolean;
  utilization: number;
  createdAt: string;
}

const PERIOD_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

const SCOPE_LABELS: Record<string, string> = {
  user: 'Per-User',
  session: 'Per-Session',
  agent: 'Per-Agent',
  global: 'Global',
};

const ACTION_COLORS: Record<string, string> = {
  warn: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  block: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30',
  notify: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30',
};

const BAR_COLORS = ['#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#8b5cf6', '#a855f7', '#ec4899'];

export default function CostsPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [periodDays, setPeriodDays] = useState('30');
  const [showAddBudget, setShowAddBudget] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);

  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

  const fetchAll = useCallback(async () => {
    if (!token) { router.push('/login'); return; }
    const days = parseInt(periodDays, 10);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const [sumRes, bdRes, bgRes] = await Promise.all([
        fetch(`/api/costs?from=${encodeURIComponent(from)}`, { headers }),
        fetch(`/api/costs/breakdown?from=${encodeURIComponent(from)}`, { headers }),
        fetch('/api/costs/budgets', { headers }),
      ]);
      if (sumRes.status === 401 || sumRes.status === 403) { router.push('/login'); return; }
      const [sumData, bdData, bgData] = await Promise.all([sumRes.json(), bdRes.json(), bgRes.json()]);
      if (sumData.success) setSummary(sumData.data);
      if (bdData.success) setBreakdown(bdData.data);
      if (bgData.success) setBudgets(bgData.data.budgets);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token, periodDays, router]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleDeleteBudget = async (id: string) => {
    if (!confirm('Delete this budget?')) return;
    try {
      await fetch(`/api/costs/budgets/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchAll();
    } catch (err: any) { alert(`✗ ${err.message}`); }
  };

  const handleToggleBudget = async (budget: Budget) => {
    try {
      await fetch(`/api/costs/budgets/${budget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: !budget.enabled }),
      });
      fetchAll();
    } catch (err: any) { alert(`✗ ${err.message}`); }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const fmtUsd = (n: number) => `$${n.toFixed(4)}`;
  const fmtTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return `${n}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <header className="border-b bg-white/80 dark:bg-slate-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => router.push('/admin')}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <h1 className="text-lg font-bold flex items-center gap-2">
              <DollarSign className="w-5 h-5" /> Costs
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Select value={periodDays} onValueChange={setPeriodDays}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={fetchAll}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        {error && (
          <Card className="mb-4 border-rose-500/30 bg-rose-500/5">
            <CardContent className="p-4 flex items-start gap-3">
              <p className="text-sm text-rose-700 dark:text-rose-400 flex-1">{error}</p>
              <Button size="sm" variant="ghost" onClick={() => setError('')}>
                <X className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Cost</CardTitle>
              <DollarSign className="w-4 h-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{summary ? fmtUsd(summary.totalCost) : '—'}</p>
              <p className="text-xs text-muted-foreground mt-1">{summary?.currency ?? 'USD'} · last {periodDays}d</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Tokens</CardTitle>
              <Zap className="w-4 h-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{summary ? fmtTokens(summary.totalTokens) : '—'}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {summary ? `${fmtTokens(summary.totalTokensInput)} in / ${fmtTokens(summary.totalTokensOutput)} out` : ''}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Requests</CardTitle>
              <Activity className="w-4 h-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{summary?.requestCount ?? '—'}</p>
              <p className="text-xs text-muted-foreground mt-1">LLM API calls</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Avg Cost / Request</CardTitle>
              <TrendingUp className="w-4 h-4 text-purple-500" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {summary && summary.requestCount > 0 ? fmtUsd(summary.totalCost / summary.requestCount) : '—'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Per-call average</p>
            </CardContent>
          </Card>
        </div>

        {/* Daily cost chart */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Daily Cost</CardTitle>
            <CardDescription>Cost trend over the selected period</CardDescription>
          </CardHeader>
          <CardContent>
            {summary && summary.daily.length > 0 ? (
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={summary.daily} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      tickFormatter={(d) => d.slice(5)}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
                      width={60}
                    />
                    <Tooltip
                      cursor={{ fill: '#10b98115' }}
                      contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                      formatter={(value: any, name: any) => {
                        if (name === 'cost') return [`$${Number(value).toFixed(4)}`, 'Cost'];
                        return [value, name];
                      }}
                      labelFormatter={(l) => `Date: ${l}`}
                    />
                    <Bar dataKey="cost" name="cost" radius={[4, 4, 0, 0]}>
                      {summary.daily.map((_, i) => (
                        <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-12">No cost data in this period</p>
            )}
          </CardContent>
        </Card>

        {/* Breakdowns */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">By Model</CardTitle>
              <CardDescription>Cost distribution per model</CardDescription>
            </CardHeader>
            <CardContent>
              {breakdown && breakdown.byModel.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Model</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right hidden sm:table-cell">Tokens</TableHead>
                      <TableHead className="text-right">Calls</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {breakdown.byModel.slice(0, 8).map((m) => (
                      <TableRow key={m.modelId ?? 'unknown'}>
                        <TableCell className="font-mono text-xs">{m.modelName}</TableCell>
                        <TableCell className="text-right font-medium">{fmtUsd(m.cost)}</TableCell>
                        <TableCell className="text-right hidden sm:table-cell">{fmtTokens(m.tokens)}</TableCell>
                        <TableCell className="text-right">{m.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-6">No data</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">By Provider</CardTitle>
              <CardDescription>Cost distribution per provider</CardDescription>
            </CardHeader>
            <CardContent>
              {breakdown && breakdown.byProvider.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Provider</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right hidden sm:table-cell">Tokens</TableHead>
                      <TableHead className="text-right">Calls</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {breakdown.byProvider.slice(0, 8).map((p) => (
                      <TableRow key={p.providerId ?? 'unknown'}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="text-sm">{p.providerName}</span>
                            <span className="text-xs text-muted-foreground">{p.providerType}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium">{fmtUsd(p.cost)}</TableCell>
                        <TableCell className="text-right hidden sm:table-cell">{fmtTokens(p.tokens)}</TableCell>
                        <TableCell className="text-right">{p.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-6">No data</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* By user (admin) */}
        {breakdown && breakdown.byUser.length > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">By User</CardTitle>
              <CardDescription>Cost distribution per user</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">Tokens</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {breakdown.byUser.slice(0, 10).map((u) => (
                    <TableRow key={u.userId ?? 'unknown'}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm">{u.userName ?? '—'}</span>
                          <span className="text-xs text-muted-foreground">{u.userEmail}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">{fmtUsd(u.cost)}</TableCell>
                      <TableCell className="text-right hidden sm:table-cell">{fmtTokens(u.tokens)}</TableCell>
                      <TableCell className="text-right">{u.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Budgets */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="w-4 h-4" /> Budgets
                </CardTitle>
                <CardDescription>Spending limits and alerts</CardDescription>
              </div>
              <Button size="sm" onClick={() => setShowAddBudget(true)}>
                <Plus className="w-4 h-4 mr-1" /> Add Budget
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {budgets.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No budgets configured. Add one to enforce spending limits.
              </p>
            ) : (
              <div className="space-y-3">
                {budgets.map((b) => (
                  <div key={b.id} className="p-4 rounded-lg border space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline">{SCOPE_LABELS[b.scope]}</Badge>
                        <Badge variant="outline">{b.period}</Badge>
                        <Badge variant="outline" className={ACTION_COLORS[b.action]}>{b.action}</Badge>
                        {!b.enabled && <Badge variant="secondary">disabled</Badge>}
                      </div>
                      <div className="flex items-center gap-1">
                        <Switch
                          checked={b.enabled}
                          onCheckedChange={() => handleToggleBudget(b)}
                          aria-label="Toggle budget"
                        />
                        <Button size="sm" variant="ghost" onClick={() => setEditingBudget(b)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-rose-500"
                          onClick={() => handleDeleteBudget(b.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div>
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="text-sm font-medium">
                          {fmtUsd(b.spentUsd)} <span className="text-muted-foreground">/ {fmtUsd(b.limitUsd)}</span>
                        </span>
                        <span className="text-xs text-muted-foreground">{b.utilization.toFixed(1)}%</span>
                      </div>
                      <Progress
                        value={b.utilization}
                        className={b.utilization >= 100 ? '[&>div]:bg-rose-500' : b.utilization >= 80 ? '[&>div]:bg-amber-500' : ''}
                      />
                      {b.utilization >= 80 && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          {b.utilization >= 100 ? 'Budget exceeded' : 'Approaching budget limit'}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <AddBudgetDialog open={showAddBudget} onOpenChange={setShowAddBudget} onSuccess={fetchAll} />
      {editingBudget && (
        <EditBudgetDialog
          budget={editingBudget}
          open={!!editingBudget}
          onOpenChange={(v) => !v && setEditingBudget(null)}
          onSuccess={fetchAll}
        />
      )}
    </div>
  );
}

function AddBudgetDialog({ open, onOpenChange, onSuccess }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
}) {
  const [scope, setScope] = useState<'user' | 'session' | 'agent' | 'global'>('global');
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'total'>('monthly');
  const [limitUsd, setLimitUsd] = useState('100');
  const [action, setAction] = useState<'warn' | 'block' | 'notify'>('warn');
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const limit = parseFloat(limitUsd);
    if (!limit || limit <= 0) { setError('Limit must be a positive number'); return; }
    setLoading(true); setError('');
    const token = localStorage.getItem('accessToken');
    try {
      const res = await fetch('/api/costs/budgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scope, period, limitUsd: limit, action, enabled }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed');
      onOpenChange(false);
      onSuccess();
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Budget</DialogTitle>
          <DialogDescription>Set a spending limit and enforcement action</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm text-rose-500">{error}</p>}
          <div className="space-y-2">
            <Label>Scope</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="global">Global (all users)</SelectItem>
                <SelectItem value="user">Per-User</SelectItem>
                <SelectItem value="session">Per-Session</SelectItem>
                <SelectItem value="agent">Per-Agent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Period</Label>
            <Select value={period} onValueChange={(v) => setPeriod(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="total">Total (never resets)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="limit">Limit (USD)</Label>
            <Input id="limit" type="number" step="0.01" min="0.01" value={limitUsd} onChange={(e) => setLimitUsd(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Action when exceeded</Label>
            <Select value={action} onValueChange={(v) => setAction(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="warn">Warn (log only)</SelectItem>
                <SelectItem value="notify">Notify (email/alert)</SelectItem>
                <SelectItem value="block">Block (reject requests)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
            <Label htmlFor="enabled-add" className="text-sm cursor-pointer">Enabled</Label>
            <Switch id="enabled-add" checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Creating...' : 'Create Budget'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditBudgetDialog({ budget, open, onOpenChange, onSuccess }: {
  budget: Budget;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
}) {
  const [limitUsd, setLimitUsd] = useState(String(budget.limitUsd));
  const [spentUsd, setSpentUsd] = useState(String(budget.spentUsd));
  const [action, setAction] = useState(budget.action);
  const [enabled, setEnabled] = useState(budget.enabled);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    const token = localStorage.getItem('accessToken');
    try {
      const res = await fetch(`/api/costs/budgets/${budget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          limitUsd: parseFloat(limitUsd),
          spentUsd: parseFloat(spentUsd),
          action,
          enabled,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed');
      onOpenChange(false);
      onSuccess();
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Budget</DialogTitle>
          <DialogDescription>
            <Badge variant="outline" className="mr-1">{SCOPE_LABELS[budget.scope]}</Badge>
            <Badge variant="outline">{budget.period}</Badge>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm text-rose-500">{error}</p>}
          <div className="space-y-2">
            <Label htmlFor="edit-limit">Limit (USD)</Label>
            <Input id="edit-limit" type="number" step="0.01" min="0.01" value={limitUsd} onChange={(e) => setLimitUsd(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-spent">Spent (USD)</Label>
            <Input id="edit-spent" type="number" step="0.01" min="0" value={spentUsd} onChange={(e) => setSpentUsd(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Action when exceeded</Label>
            <Select value={action} onValueChange={(v) => setAction(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="warn">Warn (log only)</SelectItem>
                <SelectItem value="notify">Notify (email/alert)</SelectItem>
                <SelectItem value="block">Block (reject requests)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
            <Label htmlFor="enabled-edit" className="text-sm cursor-pointer">Enabled</Label>
            <Switch id="enabled-edit" checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Saving...' : 'Save Changes'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
