'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw, Play, Wrench } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Tool { name: string; description: string; category: string; schema: any; }

export default function ToolsPage() {
  const router = useRouter();
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTool, setSelectedTool] = useState<string>('');
  const [args, setArgs] = useState('{}');
  const [result, setResult] = useState('');
  const [executing, setExecuting] = useState(false);

  const fetchTools = async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/login'); return; }
    try {
      const res = await fetch('/api/tools', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.success) { setTools(data.data.tools); if (data.data.tools.length > 0) setSelectedTool(data.data.tools[0].name); }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchTools(); }, []);

  const executeTool = async () => {
    if (!selectedTool) return;
    setExecuting(true);
    setResult('');
    const token = localStorage.getItem('accessToken');
    try {
      const parsedArgs = JSON.parse(args);
      const res = await fetch('/api/tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tool: selectedTool, args: parsedArgs }),
      });
      const data = await res.json();
      setResult(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setResult(`Error: ${err.message}`);
    } finally { setExecuting(false); }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <header className="border-b bg-white/80 dark:bg-slate-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/admin')}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
          <h1 className="text-lg font-bold">Tools</h1>
          <Badge variant="outline">{tools.length} tools</Badge>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Tools list */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase">Available Tools</h2>
            {tools.map((tool) => (
              <Card key={tool.name} className={`cursor-pointer transition-all ${selectedTool === tool.name ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'hover:border-emerald-500/30'}`} onClick={() => { setSelectedTool(tool.name); setArgs('{}'); setResult(''); }}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center"><Wrench className="w-4 h-4 text-emerald-600" /></div>
                          <div>
                            <CardTitle className="text-sm font-mono">{tool.name}</CardTitle>
                          <CardDescription className="text-xs">{tool.description}</CardDescription>
                        </div>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">{tool.category}</Badge>
                    </div>
                  </CardHeader>
                  {selectedTool === tool.name && tool.schema?.properties && (
                    <CardContent className="pt-0">
                      <div className="text-xs text-muted-foreground">
                        <p className="font-semibold mb-1">Parameters:</p>
                        {Object.entries(tool.schema.properties).map(([key, val]: [string, any]) => (
                          <div key={key} className="ml-2">
                            <code className="text-emerald-600">{key}</code>
                            {tool.schema.required?.includes(key) && <span className="text-rose-500"> *</span>}
                            <span className="text-muted-foreground/70"> — {val.description || val.type}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  )}
              </Card>
            ))}
          </div>

          {/* Execution panel */}
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Execute Tool</CardTitle><CardDescription>Test a tool with custom arguments</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label>Tool</Label>
                  <Input value={selectedTool} readOnly className="font-mono" />
                </div>
                <div className="space-y-2">
                  <Label>Arguments (JSON)</Label>
                  <Textarea value={args} onChange={(e) => setArgs(e.target.value)} className="font-mono text-xs min-h-[100px]" placeholder='{"expression": "2 + 2"}' />
                </div>
                <Button onClick={executeTool} disabled={executing || !selectedTool} className="w-full">
                  <Play className="w-4 h-4 mr-1" /> {executing ? 'Executing...' : 'Execute'}
                </Button>
              </CardContent>
            </Card>

            {result && (
              <Card>
                <CardHeader><CardTitle className="text-base">Result</CardTitle></CardHeader>
                <CardContent>
                  <pre className="text-xs bg-muted p-3 rounded-lg overflow-auto max-h-96 whitespace-pre-wrap">{result}</pre>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
