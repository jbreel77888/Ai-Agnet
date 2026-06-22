'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw, Play, Workflow, Clock, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface WF { id: string; name: string; description: string | null; enabled: boolean; }
interface Run { id: string; workflowId: string; status: string; startedAt: string; completedAt: string | null; }

export default function WorkflowsPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WF[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);

  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

  const fetchData = async () => {
    if (!token) { router.push('/login'); return; }
    try {
      const [wfRes, runRes] = await Promise.all([
        fetch('/api/workflows', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/workflows/runs', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const wfData = await wfRes.json();
      const runData = await runRes.json();
      if (wfData.success) setWorkflows(wfData.data.workflows);
      if (runData.success) setRuns(runData.data.runs);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const startWorkflow = async (wfId: string) => {
    setStarting(wfId);
    try {
      const res = await fetch('/api/workflows/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workflowId: wfId, input: { task: 'Execute workflow' } }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`✓ Started run: ${data.data.runId.substring(0, 8)}...`);
        fetchData();
      } else alert(`✗ ${data.error?.message}`);
    } catch (err: any) { alert(`✗ ${err.message}`); }
    finally { setStarting(null); }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin" /></div>;

  const statusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
      case 'failed': case 'cancelled': return <XCircle className="w-3.5 h-3.5 text-rose-500" />;
      case 'running': return <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />;
      default: return <Clock className="w-3.5 h-3.5 text-amber-500" />;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <header className="border-b bg-white/80 dark:bg-slate-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/admin')}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
          <h1 className="text-lg font-bold">Workflows</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Workflows */}
        <h2 className="text-sm font-semibold text-muted-foreground uppercase mb-3">Available Workflows</h2>
        {workflows.length === 0 ? (
          <Card><CardContent className="p-8 text-center"><Workflow className="w-10 h-10 mx-auto mb-3 text-muted-foreground" /><p className="text-sm text-muted-foreground">No workflows yet. Create one via API.</p></CardContent></Card>
        ) : (
          <div className="space-y-3 mb-8">
            {workflows.map(wf => (
              <Card key={wf.id}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{wf.name}</p>
                    <p className="text-xs text-muted-foreground">{wf.description || 'No description'}</p>
                  </div>
                  <Button size="sm" onClick={() => startWorkflow(wf.id)} disabled={starting === wf.id}>
                    <Play className="w-3 h-3 mr-1" /> {starting === wf.id ? 'Starting...' : 'Run'}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Recent runs */}
        <h2 className="text-sm font-semibold text-muted-foreground uppercase mb-3">Recent Runs</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No runs yet</p>
        ) : (
          <div className="space-y-2">
            {runs.map(run => (
              <div key={run.id} className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-3">
                  {statusIcon(run.status)}
                  <div>
                    <p className="text-sm font-mono">{run.id.substring(0, 12)}...</p>
                    <p className="text-xs text-muted-foreground">{new Date(run.startedAt).toLocaleString()}</p>
                  </div>
                </div>
                <Badge variant={run.status === 'completed' ? 'default' : run.status === 'failed' ? 'destructive' : 'secondary'}>{run.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
