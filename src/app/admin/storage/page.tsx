'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw, Upload, Download, Trash2, HardDrive } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface FileObj { key: string; sizeBytes: number; createdAt: string; }

export default function StoragePage() {
  const router = useRouter();
  const [files, setFiles] = useState<FileObj[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

  const fetchFiles = async () => {
    if (!token) { router.push('/login'); return; }
    try {
      const res = await fetch('/api/storage', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.success) setFiles(data.data.files);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { fetchFiles(); }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/storage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (data.success) { fetchFiles(); alert(`✓ Uploaded: ${data.data.key}`); }
      else alert(`✗ ${data.error?.message}`);
    } catch (err: any) { alert(`✗ ${err.message}`); }
    finally { setUploading(false); }
  };

  const downloadFile = async (key: string) => {
    const res = await fetch(`/api/storage/${key}`, { headers: { Authorization: `Bearer ${token}` } });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = key; a.click();
    URL.revokeObjectURL(url);
  };

  const deleteFile = async (key: string) => {
    if (!confirm(`Delete ${key}?`)) return;
    await fetch(`/api/storage/${key}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    fetchFiles();
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <header className="border-b bg-white/80 dark:bg-slate-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/admin')}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
          <h1 className="text-lg font-bold">Storage</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <Card className="mb-6">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Upload className="w-4 h-4" /> Upload File</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Input type="file" onChange={handleUpload} disabled={uploading} />
              {uploading && <RefreshCw className="w-4 h-4 animate-spin" />}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><HardDrive className="w-4 h-4" /> Files ({files.length})</CardTitle></CardHeader>
          <CardContent>
            {files.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No files yet</p>
            ) : (
              <div className="space-y-2">
                {files.map(file => (
                  <div key={file.key} className="flex items-center justify-between p-3 rounded-lg border">
                    <div>
                      <p className="text-sm font-mono">{file.key}</p>
                      <p className="text-xs text-muted-foreground">{file.sizeBytes > 0 ? `${(file.sizeBytes / 1024).toFixed(1)} KB` : ''} · {new Date(file.createdAt).toLocaleDateString()}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => downloadFile(file.key)}><Download className="w-3.5 h-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="text-rose-500" onClick={() => deleteFile(file.key)}><Trash2 className="w-3.5 h-3.5" /></Button>
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
