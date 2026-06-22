'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw, Upload, FileText, Search, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Doc { id: string; name: string; status: string; sourceType: string; sizeBytes: number; createdAt: string; }

export default function DocumentsPage() {
  const router = useRouter();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState('');
  const [uploading, setUploading] = useState(false);
  const [searching, setSearching] = useState(false);

  const fetchDocs = async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/login'); return; }
    try {
      const res = await fetch('/api/documents', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.success) setDocs(data.data.documents);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { fetchDocs(); }, []);

  const upload = async () => {
    if (!name || !content) return;
    setUploading(true);
    const token = localStorage.getItem('accessToken');
    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, content }),
      });
      const data = await res.json();
      if (data.success) { setName(''); setContent(''); fetchDocs(); alert(`✓ Uploaded: ${data.data.chunksCreated} chunks`); }
      else alert(`✗ ${data.error?.message}`);
    } catch (err: any) { alert(`✗ ${err.message}`); }
    finally { setUploading(false); }
  };

  const search = async () => {
    if (!query) return;
    setSearching(true);
    setResults('');
    const token = localStorage.getItem('accessToken');
    try {
      const res = await fetch('/api/documents/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: query, topK: 5 }),
      });
      const data = await res.json();
      if (data.success) {
        const output = data.data.results.map((r: any, i: number) => `--- Result ${i+1} (score: ${r.score.toFixed(2)}) ---\nDocument: ${r.documentName}\nContent: ${r.content.substring(0, 300)}...\n`).join('\n');
        setResults(output || 'No results found');
      }
    } catch {} finally { setSearching(false); }
  };

  const deleteDoc = async (id: string) => {
    const token = localStorage.getItem('accessToken');
    await fetch(`/api/documents`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    fetchDocs();
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <header className="border-b bg-white/80 dark:bg-slate-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/admin')}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
          <h1 className="text-lg font-bold">Documents & RAG</h1>
          <Badge variant="outline">{docs.length} docs</Badge>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Upload */}
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Upload className="w-4 h-4" /> Upload Document</CardTitle><CardDescription>Add text content for semantic search</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="document-name.txt" /></div>
              <div className="space-y-2"><Label>Content</Label><Textarea value={content} onChange={(e) => setContent(e.target.value)} className="min-h-[150px] font-mono text-xs" placeholder="Paste text content here..." /></div>
              <Button onClick={upload} disabled={uploading || !name || !content} className="w-full"><Upload className="w-4 h-4 mr-1" /> {uploading ? 'Uploading...' : 'Upload'}</Button>
            </CardContent>
          </Card>

          {/* Search */}
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Search className="w-4 h-4" /> Semantic Search</CardTitle><CardDescription>Search across all documents</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2"><Label>Query</Label><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="What to search for..." onKeyDown={(e) => e.key === 'Enter' && search()} /></div>
              <Button onClick={search} disabled={searching || !query} className="w-full"><Search className="w-4 h-4 mr-1" /> {searching ? 'Searching...' : 'Search'}</Button>
              {results && <pre className="text-xs bg-muted p-3 rounded-lg overflow-auto max-h-64 whitespace-pre-wrap">{results}</pre>}
            </CardContent>
          </Card>
        </div>

        {/* Documents list */}
        <Card className="mt-6">
          <CardHeader><CardTitle className="text-base">Documents</CardTitle></CardHeader>
          <CardContent>
            {docs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No documents yet. Upload one above.</p>
            ) : (
              <div className="space-y-2">
                {docs.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{doc.name}</p>
                        <p className="text-xs text-muted-foreground">{(doc.sizeBytes / 1024).toFixed(1)} KB · {new Date(doc.createdAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={doc.status === 'ready' ? 'default' : 'secondary'}>{doc.status}</Badge>
                      <Button size="sm" variant="ghost" className="text-rose-500" onClick={() => deleteDoc(doc.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
