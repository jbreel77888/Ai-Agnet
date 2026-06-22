'use client';

import { Fragment, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, RefreshCw, Activity, Shield, ChevronLeft, ChevronRight,
  Search, Clock, ChevronDown, ChevronRight as ExpandIcon,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

interface TraceLog {
  id: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: string;
  startTime: string;
  endTime: string | null;
  durationMs: number;
  status: 'ok' | 'error' | 'unset';
  attributes: any;
  events: any;
  resource: any;
}

interface AuditLog {
  id: string;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  before: any;
  after: any;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const STATUS_COLORS: Record<string, string> = {
  ok: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  error: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30',
  unset: 'bg-slate-500/15 text-slate-700 dark:text-slate-400 border-slate-500/30',
};

const KIND_COLORS: Record<string, string> = {
  internal: 'bg-slate-500/15 text-slate-700 dark:text-slate-400',
  client: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  server: 'bg-purple-500/15 text-purple-700 dark:text-purple-400',
  producer: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  consumer: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400',
};

const PAGE_SIZE = 25;

export default function LogsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'traces' | 'audit'>('traces');

  // Traces state
  const [traces, setTraces] = useState<TraceLog[]>([]);
  const [tracePagination, setTracePagination] = useState<Pagination | null>(null);
  const [tracePage, setTracePage] = useState(1);
  const [traceSearch, setTraceSearch] = useState('');
  const [traceStatus, setTraceStatus] = useState<string>('all');
  const [loadingTraces, setLoadingTraces] = useState(true);
  const [selectedTrace, setSelectedTrace] = useState<TraceLog | null>(null);
  const [expandedTraceId, setExpandedTraceId] = useState<string | null>(null);

  // Audit state
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditPagination, setAuditPagination] = useState<Pagination | null>(null);
  const [auditPage, setAuditPage] = useState(1);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditResourceType, setAuditResourceType] = useState<string>('all');
  const [loadingAudit, setLoadingAudit] = useState(true);
  const [selectedAudit, setSelectedAudit] = useState<AuditLog | null>(null);

  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

  const fetchTraces = useCallback(async () => {
    if (!token) { router.push('/login'); return; }
    setLoadingTraces(true);
    try {
      const params = new URLSearchParams({
        page: String(tracePage),
        pageSize: String(PAGE_SIZE),
      });
      if (traceSearch) params.set('name', traceSearch);
      if (traceStatus !== 'all') params.set('status', traceStatus);

      const res = await fetch(`/api/logs?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) { router.push('/login'); return; }
      const data = await res.json();
      if (data.success) {
        setTraces(data.data.logs);
        setTracePagination(data.data.pagination);
      }
    } catch (err) { console.error(err); }
    finally { setLoadingTraces(false); }
  }, [token, tracePage, traceSearch, traceStatus, router]);

  const fetchAudit = useCallback(async () => {
    if (!token) { router.push('/login'); return; }
    setLoadingAudit(true);
    try {
      const params = new URLSearchParams({
        page: String(auditPage),
        pageSize: String(PAGE_SIZE),
      });
      if (auditSearch) params.set('action', auditSearch);
      if (auditResourceType !== 'all') params.set('resourceType', auditResourceType);

      const res = await fetch(`/api/audit?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 403) { router.push('/login'); return; }
      const data = await res.json();
      if (data.success) {
        setAuditLogs(data.data.logs);
        setAuditPagination(data.data.pagination);
      }
    } catch (err) { console.error(err); }
    finally { setLoadingAudit(false); }
  }, [token, auditPage, auditSearch, auditResourceType, router]);

  useEffect(() => {
    if (tab === 'traces') fetchTraces();
    else fetchAudit();
  }, [tab, fetchTraces, fetchAudit]);

  if (loadingTraces && tab === 'traces' && traces.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const fmtDuration = (ms: number) => {
    if (ms < 1) return '<1ms';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
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
              <Activity className="w-5 h-5" /> Logs
            </h1>
          </div>
          <Button variant="outline" size="sm" onClick={() => (tab === 'traces' ? fetchTraces() : fetchAudit())}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="mb-4">
            <TabsTrigger value="traces" className="gap-1">
              <Activity className="w-3.5 h-3.5" /> Traces
              {tracePagination && (
                <Badge variant="secondary" className="ml-1 text-[10px]">{tracePagination.total}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="audit" className="gap-1">
              <Shield className="w-3.5 h-3.5" /> Audit
              {auditPagination && (
                <Badge variant="secondary" className="ml-1 text-[10px]">{auditPagination.total}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* === Traces tab === */}
          <TabsContent value="traces">
            <Card className="mb-4">
              <CardContent className="p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="trace-search" className="text-xs">Search by name</Label>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="trace-search"
                        placeholder="e.g. chat.completion"
                        value={traceSearch}
                        onChange={(e) => { setTraceSearch(e.target.value); setTracePage(1); }}
                        className="pl-8"
                        onKeyDown={(e) => e.key === 'Enter' && fetchTraces()}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Status</Label>
                    <Select value={traceStatus} onValueChange={(v) => { setTraceStatus(v); setTracePage(1); }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        <SelectItem value="ok">OK</SelectItem>
                        <SelectItem value="error">Error</SelectItem>
                        <SelectItem value="unset">Unset</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0">
                {traces.length === 0 ? (
                  <div className="text-center py-12">
                    <Activity className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">No traces found</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead className="hidden md:table-cell">Kind</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Duration</TableHead>
                        <TableHead className="hidden sm:table-cell text-right">Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {traces.map((t) => (
                        <Fragment key={t.id}>
                          <TableRow
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => setExpandedTraceId(expandedTraceId === t.id ? null : t.id)}
                          >
                            <TableCell className="w-8">
                              {expandedTraceId === t.id
                                ? <ChevronDown className="w-3.5 h-3.5" />
                                : <ExpandIcon className="w-3.5 h-3.5" />}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {t.name}
                              <div className="text-[10px] text-muted-foreground">trace: {t.traceId.slice(0, 12)}…</div>
                            </TableCell>
                            <TableCell className="hidden md:table-cell">
                              <Badge variant="outline" className={KIND_COLORS[t.kind] ?? ''}>{t.kind}</Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={STATUS_COLORS[t.status]}>{t.status}</Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">{fmtDuration(t.durationMs)}</TableCell>
                            <TableCell className="hidden sm:table-cell text-right text-xs text-muted-foreground">
                              {fmtTime(t.startTime)}
                            </TableCell>
                          </TableRow>
                          {expandedTraceId === t.id && (
                            <TableRow className="bg-muted/30">
                              <TableCell colSpan={6} className="p-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                                  <div>
                                    <p className="font-semibold mb-1">Span IDs</p>
                                    <p className="font-mono">span: {t.spanId}</p>
                                    {t.parentSpanId && <p className="font-mono">parent: {t.parentSpanId}</p>}
                                    <p className="mt-2 font-semibold">Timing</p>
                                    <p>Start: {fmtTime(t.startTime)}</p>
                                    {t.endTime && <p>End: {fmtTime(t.endTime)}</p>}
                                    <p>Duration: {fmtDuration(t.durationMs)}</p>
                                  </div>
                                  <div>
                                    <p className="font-semibold mb-1">Attributes</p>
                                    <pre className="bg-muted p-2 rounded text-[10px] overflow-auto max-h-40">
                                      {JSON.stringify(t.attributes ?? {}, null, 2)}
                                    </pre>
                                    {t.resource && (
                                      <>
                                        <p className="font-semibold mt-2 mb-1">Resource</p>
                                        <pre className="bg-muted p-2 rounded text-[10px] overflow-auto max-h-40">
                                          {JSON.stringify(t.resource, null, 2)}
                                        </pre>
                                      </>
                                    )}
                                  </div>
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="mt-3"
                                  onClick={(e) => { e.stopPropagation(); setSelectedTrace(t); }}
                                >
                                  View Full JSON
                                </Button>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {tracePagination && (
              <PaginationControls
                pagination={tracePagination}
                onPageChange={setTracePage}
              />
            )}
          </TabsContent>

          {/* === Audit tab === */}
          <TabsContent value="audit">
            <Card className="mb-4">
              <CardContent className="p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="audit-search" className="text-xs">Search by action</Label>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="audit-search"
                        placeholder="e.g. user.create"
                        value={auditSearch}
                        onChange={(e) => { setAuditSearch(e.target.value); setAuditPage(1); }}
                        className="pl-8"
                        onKeyDown={(e) => e.key === 'Enter' && fetchAudit()}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Resource type</Label>
                    <Select value={auditResourceType} onValueChange={(v) => { setAuditResourceType(v); setAuditPage(1); }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All types</SelectItem>
                        <SelectItem value="user">user</SelectItem>
                        <SelectItem value="provider">provider</SelectItem>
                        <SelectItem value="agent">agent</SelectItem>
                        <SelectItem value="budget">budget</SelectItem>
                        <SelectItem value="session">session</SelectItem>
                        <SelectItem value="workflow">workflow</SelectItem>
                        <SelectItem value="document">document</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0">
                {loadingAudit && auditLogs.length === 0 ? (
                  <div className="text-center py-12">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Loading audit logs...</p>
                  </div>
                ) : auditLogs.length === 0 ? (
                  <div className="text-center py-12">
                    <Shield className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">No audit logs found</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Action</TableHead>
                        <TableHead className="hidden md:table-cell">Resource</TableHead>
                        <TableHead className="hidden sm:table-cell">User</TableHead>
                        <TableHead className="text-right">Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {auditLogs.map((a) => (
                        <TableRow
                          key={a.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setSelectedAudit(a)}
                        >
                          <TableCell>
                            <span className="font-mono text-xs font-medium">{a.action}</span>
                            {a.ipAddress && (
                              <div className="text-[10px] text-muted-foreground">{a.ipAddress}</div>
                            )}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-xs">
                            <span className="font-mono">{a.resourceType}</span>
                            {a.resourceId && (
                              <div className="text-[10px] text-muted-foreground">{a.resourceId.slice(0, 12)}…</div>
                            )}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-xs">
                            {a.userEmail ?? '—'}
                            {a.userName && (
                              <div className="text-[10px] text-muted-foreground">{a.userName}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            <Clock className="w-3 h-3 inline mr-1" />
                            {fmtTime(a.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {auditPagination && (
              <PaginationControls
                pagination={auditPagination}
                onPageChange={setAuditPage}
              />
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* Trace detail dialog */}
      <Dialog open={!!selectedTrace} onOpenChange={(v) => !v && setSelectedTrace(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{selectedTrace?.name}</DialogTitle>
          </DialogHeader>
          {selectedTrace && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Trace ID:</span> <span className="font-mono">{selectedTrace.traceId}</span></div>
                <div><span className="text-muted-foreground">Span ID:</span> <span className="font-mono">{selectedTrace.spanId}</span></div>
                <div><span className="text-muted-foreground">Parent:</span> <span className="font-mono">{selectedTrace.parentSpanId ?? '—'}</span></div>
                <div><span className="text-muted-foreground">Kind:</span> {selectedTrace.kind}</div>
                <div><span className="text-muted-foreground">Status:</span> {selectedTrace.status}</div>
                <div><span className="text-muted-foreground">Duration:</span> {fmtDuration(selectedTrace.durationMs)}</div>
                <div><span className="text-muted-foreground">Start:</span> {fmtTime(selectedTrace.startTime)}</div>
                <div><span className="text-muted-foreground">End:</span> {selectedTrace.endTime ? fmtTime(selectedTrace.endTime) : '—'}</div>
              </div>
              <div>
                <p className="font-semibold mb-1">Attributes</p>
                <pre className="bg-muted p-2 rounded text-[10px] overflow-auto max-h-60">
                  {JSON.stringify(selectedTrace.attributes ?? {}, null, 2)}
                </pre>
              </div>
              {selectedTrace.events && (
                <div>
                  <p className="font-semibold mb-1">Events</p>
                  <pre className="bg-muted p-2 rounded text-[10px] overflow-auto max-h-40">
                    {JSON.stringify(selectedTrace.events, null, 2)}
                  </pre>
                </div>
              )}
              {selectedTrace.resource && (
                <div>
                  <p className="font-semibold mb-1">Resource</p>
                  <pre className="bg-muted p-2 rounded text-[10px] overflow-auto max-h-40">
                    {JSON.stringify(selectedTrace.resource, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Audit detail dialog */}
      <Dialog open={!!selectedAudit} onOpenChange={(v) => !v && setSelectedAudit(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{selectedAudit?.action}</DialogTitle>
          </DialogHeader>
          {selectedAudit && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">User:</span> {selectedAudit.userEmail ?? '—'}</div>
                <div><span className="text-muted-foreground">Resource:</span> <span className="font-mono">{selectedAudit.resourceType}</span></div>
                <div><span className="text-muted-foreground">Resource ID:</span> <span className="font-mono">{selectedAudit.resourceId ?? '—'}</span></div>
                <div><span className="text-muted-foreground">Time:</span> {fmtTime(selectedAudit.createdAt)}</div>
                <div><span className="text-muted-foreground">IP:</span> {selectedAudit.ipAddress ?? '—'}</div>
                <div className="col-span-2 truncate"><span className="text-muted-foreground">UA:</span> {selectedAudit.userAgent ?? '—'}</div>
              </div>
              {selectedAudit.before != null && (
                <div>
                  <p className="font-semibold mb-1 text-rose-600 dark:text-rose-400">Before</p>
                  <pre className="bg-muted p-2 rounded text-[10px] overflow-auto max-h-48">
                    {JSON.stringify(selectedAudit.before, null, 2)}
                  </pre>
                </div>
              )}
              {selectedAudit.after != null && (
                <div>
                  <p className="font-semibold mb-1 text-emerald-600 dark:text-emerald-400">After</p>
                  <pre className="bg-muted p-2 rounded text-[10px] overflow-auto max-h-48">
                    {JSON.stringify(selectedAudit.after, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PaginationControls({ pagination, onPageChange }: {
  pagination: Pagination;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-between mt-4">
      <p className="text-xs text-muted-foreground">
        Page {pagination.page} of {pagination.totalPages} · {pagination.total} total
      </p>
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="outline"
          disabled={pagination.page <= 1}
          onClick={() => onPageChange(pagination.page - 1)}
        >
          <ChevronLeft className="w-4 h-4" /> Prev
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pagination.page >= pagination.totalPages}
          onClick={() => onPageChange(pagination.page + 1)}
        >
          Next <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
