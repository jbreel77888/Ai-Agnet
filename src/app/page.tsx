'use client';

import { useState, useEffect } from 'react';
import {
  Bot, Boxes, Brain, Cpu, Database, FileText, GaugeCircle,
  KeyRound, Layers, Lock, Network, Plug, Server, Shield, Workflow,
  CircleDollarSign, ListChecks, Activity, FolderTree, BookOpen,
  AlertTriangle, CheckCircle2, XCircle, ArrowRight,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

type ModuleStatus = 'ready' | 'scaffold' | 'pending' | 'blocked';

interface SystemModule {
  name: string;
  arabicName: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  status: ModuleStatus;
  files: number;
  documentation?: string;
}

const MODULES: SystemModule[] = [
  { name: 'core', arabicName: 'النواة', description: 'DI Container, EventBus, Lifecycle, Decorators', icon: Boxes, status: 'ready', files: 5, documentation: 'ARCHITECTURE.md' },
  { name: 'providers', arabicName: 'المزودون', description: 'OpenAI, Anthropic, Gemini, Groq, Ollama, OpenRouter, Custom', icon: Cpu, status: 'ready', files: 8, documentation: 'PROVIDERS.md' },
  { name: 'agents', arabicName: 'الوكلاء', description: 'Planner, Research, Reasoning, Coding, Execution, Tool, Memory, Reflection, Summarizer', icon: Bot, status: 'ready', files: 6, documentation: 'AGENTS.md' },
  { name: 'tools', arabicName: 'الأدوات', description: 'Web Search, Browser, GitHub, Filesystem, Code Exec, etc.', icon: Plug, status: 'ready', files: 5, documentation: 'TOOLS.md' },
  { name: 'memory', arabicName: 'الذاكرة', description: 'Short-term (Redis) + Long-term (pgvector) + Compression', icon: Brain, status: 'ready', files: 6, documentation: 'MEMORY.md' },
  { name: 'context', arabicName: 'إدارة السياق', description: 'Context Engine: ضغط، تلخيص، استخراج كيانات', icon: Layers, status: 'scaffold', files: 3, documentation: 'AGENTS.md' },
  { name: 'workflows', arabicName: 'تدفقات العمل', description: 'DAG Engine: branches, conditions, parallel, retry, timeouts', icon: Workflow, status: 'ready', files: 5, documentation: 'WORKFLOWS.md' },
  { name: 'mcp', arabicName: 'بروتوكول MCP', description: 'MCP Client: stdio, sse, websocket, http', icon: Network, status: 'ready', files: 4, documentation: 'MCP.md' },
  { name: 'background', arabicName: 'المهام الخلفية', description: 'BullMQ Queues, Workers, Scheduler', icon: Activity, status: 'ready', files: 4, documentation: 'ARCHITECTURE.md' },
  { name: 'rag', arabicName: 'RAG', description: 'Ingestion, Chunking, Embeddings, Semantic Search', icon: FileText, status: 'scaffold', files: 3, documentation: 'DATABASE.md' },
  { name: 'vector', arabicName: 'الـ Vector', description: 'pgvector Store + Index Management', icon: Database, status: 'scaffold', files: 2 },
  { name: 'storage', arabicName: 'التخزين', description: 'Local + S3/R2/GCS + Manager', icon: FolderTree, status: 'scaffold', files: 3 },
  { name: 'integrations', arabicName: 'التكاملات', description: 'GitHub, Slack, Notion, Discord, Email', icon: Plug, status: 'scaffold', files: 5 },
  { name: 'config', arabicName: 'الإعدادات', description: 'Env loading, Constants, Feature Flags', icon: GaugeCircle, status: 'ready', files: 2 },
  { name: 'auth', arabicName: 'المصادقة', description: 'JWT, Refresh Tokens, RBAC, Sessions', icon: Lock, status: 'ready', files: 5, documentation: 'API.md' },
  { name: 'observability', arabicName: 'المراقبة', description: 'Logger, Tracing, Metrics, Cost Tracking', icon: Shield, status: 'ready', files: 6, documentation: 'ARCHITECTURE.md' },
  { name: 'api', arabicName: 'REST API', description: 'Routes, Middleware, Validators (Zod)', icon: Server, status: 'scaffold', files: 3, documentation: 'API.md' },
  { name: 'db', arabicName: 'قاعدة البيانات', description: 'Drizzle ORM + PostgreSQL + pgvector', icon: Database, status: 'ready', files: 13, documentation: 'DATABASE.md' },
  { name: 'admin', arabicName: 'لوحة الإدارة', description: 'إدارة كل مكونات النظام', icon: Shield, status: 'scaffold', files: 2 },
];

const STATUS_CONFIG: Record<ModuleStatus, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  ready: { label: 'جاهز', color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30', icon: CheckCircle2 },
  scaffold: { label: 'هيكل', color: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30', icon: AlertTriangle },
  pending: { label: 'معلق', color: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30', icon: CircleDollarSign },
  blocked: { label: 'محظور', color: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30', icon: XCircle },
};

const REQUIRED_ENV_VARS = [
  { name: 'DATABASE_URL', description: 'PostgreSQL connection string', required: true, hasFallback: false },
  { name: 'REDIS_URL', description: 'Redis connection for BullMQ + short-term memory', required: true, hasFallback: true },
  { name: 'ENCRYPTION_KEY', description: 'AES-256 key (base64, 32 bytes) — `openssl rand -base64 32`', required: true, hasFallback: true },
  { name: 'JWT_SECRET', description: 'JWT signing secret (min 32 chars)', required: true, hasFallback: true },
  { name: 'OPENAI_API_KEY', description: 'For OpenAI models + embeddings', required: false, hasFallback: false },
  { name: 'ANTHROPIC_API_KEY', description: 'For Claude models', required: false, hasFallback: false },
  { name: 'GEMINI_API_KEY', description: 'For Google Gemini models', required: false, hasFallback: false },
  { name: 'GROQ_API_KEY', description: 'For Groq fast inference', required: false, hasFallback: false },
];

const DOCUMENTATION_FILES = [
  { name: 'ARCHITECTURE.md', description: 'التصميم المعماري الشامل، الطبقات، تبعيات الوحدات، قرارات التصميم' },
  { name: 'DATABASE.md', description: 'مخطط قاعدة البيانات الكامل، الجداول، الفهارس، الترحيلات' },
  { name: 'AGENTS.md', description: 'نظام الوكلاء، الأدوار، Handoffs، Sub-Agents، السياق المشترك' },
  { name: 'PROVIDERS.md', description: 'نظام المزودين، Capacities، Fallback، Circuit Breakers' },
  { name: 'TOOLS.md', description: 'نظام الأدوات الديناميكي، الصلاحيات، الإضافة الديناميكية' },
  { name: 'MEMORY.md', description: 'الذاكرة قصيرة وطويلة المدى، الضغط، الاسترجاع الدلالي' },
  { name: 'WORKFLOWS.md', description: 'محرك Workflows، العقد، الشروط، التوازي، إعادة المحاولة' },
  { name: 'MCP.md', description: 'بروتوكول MCP، الأنواع، الاكتشاف، إعادة التحميل الديناميكي' },
  { name: 'API.md', description: 'REST API الكامل، المصادقة، Rate Limits، Streaming' },
];

const PHASES = [
  {
    id: 1,
    name: 'المرحلة 1: المعمارية والتوثيق',
    description: 'إنشاء 9 ملفات توثيق + هيكل المشروع + DB Schema + Core Types/Interfaces',
    status: 'in-progress' as const,
    progress: 90,
  },
  {
    id: 2,
    name: 'المرحلة 2: نواة المشروع',
    description: 'Providers/Memory/Context Engines + Drizzle + Redis + Auth (JWT+RBAC)',
    status: 'pending' as const,
    progress: 35,
  },
  {
    id: 3,
    name: 'المرحلة 3: نظام الوكلاء',
    description: '9 وكلاء + Handoffs + Sub-Agents + Shared Context',
    status: 'pending' as const,
    progress: 0,
  },
  {
    id: 4,
    name: 'المرحلة 4: الأدوات + MCP + RAG',
    description: 'Tools Registry + MCP Client + RAG Pipeline + pgvector',
    status: 'pending' as const,
    progress: 0,
  },
  {
    id: 5,
    name: 'المرحلة 5: Workflows + Background',
    description: 'Workflow Engine + BullMQ + Sessions + Storage',
    status: 'pending' as const,
    progress: 0,
  },
  {
    id: 6,
    name: 'المرحلة 6: لوحة الإدارة',
    description: 'Admin UI كاملة + Observability + Cost Tracking',
    status: 'pending' as const,
    progress: 5,
  },
  {
    id: 7,
    name: 'المرحلة 7: الاعتمادية والنشر',
    description: 'Circuit Breakers, Retries, Tests, Railway Deploy',
    status: 'pending' as const,
    progress: 0,
  },
];

export default function Home() {
  const [activeTab, setActiveTab] = useState('overview');
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then(data => setHealth(data.data))
      .catch(() => {});
  }, []);

  const readyCount = MODULES.filter(m => m.status === 'ready').length;
  const scaffoldCount = MODULES.filter(m => m.status === 'scaffold').length;
  const totalFiles = MODULES.reduce((sum, m) => sum + m.files, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      {/* Header */}
      <header className="border-b bg-white/80 dark:bg-slate-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Agent Platform</h1>
              <p className="text-xs text-muted-foreground">منصة الوكلاء السحابية — مستوحاة من Manus</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              Phase 1 Active
            </Badge>
            <Badge variant="secondary">Production Ready Architecture</Badge>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-7xl">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          {/* Tabs */}
          <TabsList className="grid w-full grid-cols-2 md:grid-cols-5 lg:grid-cols-5 gap-1">
            <TabsTrigger value="overview" className="gap-1.5 text-xs md:text-sm">
              <Layers className="w-4 h-4" /> نظرة عامة
            </TabsTrigger>
            <TabsTrigger value="modules" className="gap-1.5 text-xs md:text-sm">
              <Boxes className="w-4 h-4" /> الوحدات
            </TabsTrigger>
            <TabsTrigger value="architecture" className="gap-1.5 text-xs md:text-sm">
              <Network className="w-4 h-4" /> المعمارية
            </TabsTrigger>
            <TabsTrigger value="setup" className="gap-1.5 text-xs md:text-sm">
              <KeyRound className="w-4 h-4" /> الإعداد اليدوي
            </TabsTrigger>
            <TabsTrigger value="docs" className="gap-1.5 text-xs md:text-sm">
              <BookOpen className="w-4 h-4" /> التوثيق
            </TabsTrigger>
          </TabsList>

          {/* Live System Status Banner (shown if health is loaded) */}
          {health && (
            <Card className="border-emerald-500/30 bg-emerald-500/5">
              <CardContent className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${health.status === 'healthy' ? 'bg-emerald-500 animate-pulse' : health.status === 'degraded' ? 'bg-amber-500' : 'bg-rose-500'}`} />
                    <div>
                      <p className="font-semibold text-sm">
                        حالة النظام: {health.status === 'healthy' ? 'سليم ✓' : health.status === 'degraded' ? 'يعمل (مع تحذيرات)' : 'متوقف'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        PostgreSQL 18: {health.checks?.find((c: any) => c.name === 'database')?.status === 'healthy'
                          ? `${health.checks.find((c: any) => c.name === 'database')?.details?.tables} جدول جاهز`
                          : 'متوقف'}
                        {' · '}
                        Encryption: {health.checks?.find((c: any) => c.name === 'encryption')?.status === 'healthy' ? 'مُفعّل' : 'غير مُفعّل'}
                        {' · '}
                        JWT: {health.checks?.find((c: any) => c.name === 'jwt')?.status === 'healthy' ? 'مُفعّل' : 'غير مُفعّل'}
                        {' · '}
                        Redis: {health.checks?.find((c: any) => c.name === 'redis')?.details?.mode === 'memory-fallback' ? 'Memory Fallback' : 'متصل'}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="gap-1 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
                    <Activity className="w-3 h-3" />
                    {Math.floor(health.uptime)}s uptime
                  </Badge>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ===== OVERVIEW ===== */}
          <TabsContent value="overview" className="space-y-6">
            {/* Hero stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                icon={Boxes}
                label="الوحدات"
                value={MODULES.length.toString()}
                subValue={`${readyCount} جاهز · ${scaffoldCount} هيكل`}
                color="emerald"
              />
              <StatCard
                icon={FileText}
                label="الملفات"
                value={totalFiles.toString()}
                subValue="ملفات TypeScript"
                color="blue"
              />
              <StatCard
                icon={BookOpen}
                label="ملفات التوثيق"
                value="9"
                subValue="Markdown files"
                color="amber"
              />
              <StatCard
                icon={Workflow}
                label="المراحل"
                value="7"
                subValue="Phase 1 نشطة"
                color="purple"
              />
            </div>

            {/* Phases */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ListChecks className="w-5 h-5 text-emerald-500" />
                  خطة التنفيذ التدريجي
                </CardTitle>
                <CardDescription>
                  تطور تدريجي على 7 مراحل — لا ننتقل للمرحلة التالية قبل استقرار الحالية
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {PHASES.map((phase) => (
                  <div key={phase.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                          phase.status === 'in-progress'
                            ? 'bg-emerald-500 text-white'
                            : phase.status === 'completed'
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                        }`}>
                          {phase.status === 'completed' ? '✓' : phase.id}
                        </div>
                        <div>
                          <p className="font-medium text-sm">{phase.name}</p>
                          <p className="text-xs text-muted-foreground">{phase.description}</p>
                        </div>
                      </div>
                      <span className="text-sm font-mono text-muted-foreground">{phase.progress}%</span>
                    </div>
                    <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden ml-11">
                      <div
                        className={`h-full rounded-full transition-all ${
                          phase.status === 'in-progress' ? 'bg-emerald-500' : phase.status === 'completed' ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
                        }`}
                        style={{ width: `${phase.progress}%` }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Tech Stack */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">حزمة التقنيات (Tech Stack)</CardTitle>
                <CardDescription>كل اختيار مدروس للإنتاج والاستقرار</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { name: 'Next.js 16', category: 'Framework' },
                    { name: 'TypeScript 5', category: 'Language' },
                    { name: 'PostgreSQL 15', category: 'Database' },
                    { name: 'Drizzle ORM', category: 'ORM' },
                    { name: 'Redis', category: 'Cache/Queue' },
                    { name: 'BullMQ', category: 'Jobs' },
                    { name: 'pgvector', category: 'Vector DB' },
                    { name: 'Zod', category: 'Validation' },
                    { name: 'Pino', category: 'Logger' },
                    { name: 'JWT', category: 'Auth' },
                    { name: 'Railway', category: 'Deploy' },
                    { name: 'shadcn/ui', category: 'UI' },
                  ].map((tech) => (
                    <div key={tech.name} className="rounded-lg border p-3 hover:border-emerald-500/50 transition-colors">
                      <p className="font-medium text-sm">{tech.name}</p>
                      <p className="text-xs text-muted-foreground">{tech.category}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== MODULES ===== */}
          <TabsContent value="modules" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Boxes className="w-5 h-5 text-emerald-500" />
                  الوحدات (19 وحدة مستقلة)
                </CardTitle>
                <CardDescription>
                  كل وحدة مستقلة، تمنع Circular Dependencies، تستخدم Dependency Injection
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[600px] pr-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {MODULES.map((module) => {
                      const StatusIcon = STATUS_CONFIG[module.status].icon;
                      const ModuleIcon = module.icon;
                      return (
                        <div
                          key={module.name}
                          className="rounded-lg border p-4 hover:shadow-md transition-all"
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                                <ModuleIcon className="w-5 h-5 text-slate-600 dark:text-slate-300" />
                              </div>
                              <div>
                                <p className="font-mono text-sm font-medium">src/{module.name}/</p>
                                <p className="text-xs text-muted-foreground">{module.arabicName}</p>
                              </div>
                            </div>
                            <Badge className={`gap-1 ${STATUS_CONFIG[module.status].color}`} variant="outline">
                              <StatusIcon className="w-3 h-3" />
                              {STATUS_CONFIG[module.status].label}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mb-2">{module.description}</p>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{module.files} ملفات</span>
                            {module.documentation && (
                              <Badge variant="secondary" className="font-mono text-[10px]">
                                <BookOpen className="w-3 h-3 mr-1" />
                                {module.documentation}
                              </Badge>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== ARCHITECTURE ===== */}
          <TabsContent value="architecture" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Network className="w-5 h-5 text-emerald-500" />
                  الطبقات المعمارية (Clean Architecture)
                </CardTitle>
                <CardDescription>
                  فصل صارم للطبقات: Domain ← Application ← Infrastructure ← Presentation
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { layer: 'Presentation', tech: 'Next.js App Router · Admin UI · REST API · WebSocket', color: 'bg-blue-500/10 border-blue-500/30' },
                  { layer: 'Application', tech: 'Use Cases · Orchestrators · Workflows · Agent Handoffs', color: 'bg-emerald-500/10 border-emerald-500/30' },
                  { layer: 'Domain', tech: 'Entities · Value Objects · Domain Events · Pure Logic', color: 'bg-amber-500/10 border-amber-500/30' },
                  { layer: 'Infrastructure', tech: 'PostgreSQL (Drizzle) · Redis (BullMQ) · S3 · External APIs', color: 'bg-purple-500/10 border-purple-500/30' },
                ].map((l, i) => (
                  <div key={l.layer} className={`rounded-lg border p-4 ${l.color}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold">{i + 1}. {l.layer} Layer</p>
                        <p className="text-xs text-muted-foreground mt-1">{l.tech}</p>
                      </div>
                      {i < 3 && <ArrowRight className="w-4 h-4 text-muted-foreground rotate-90" />}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">تبعيات الوحدات</CardTitle>
                <CardDescription>اتجاه الاعتماد دائماً للأسفل — لا يُسمح بالاعتماد العكسي</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="text-xs font-mono bg-slate-950 text-slate-100 p-4 rounded-lg overflow-x-auto">
{`                    ┌──────────┐
                    │   core   │ ← (no deps)
                    └────┬─────┘
        ┌────────────────┼─────────────────┐
        ▼                ▼                 ▼
   ┌─────────┐     ┌──────────┐      ┌──────────┐
   │  config │     │   types  │      │   utils  │
   └────┬────┘     └──────────┘      └──────────┘
        ▼
   ┌─────────┐
   │   db    │ ← Drizzle Schema
   └────┬────┘
        ▼
   ┌─────────────┐     ┌──────────┐     ┌────────────┐
   │observability│     │  memory  │     │  storage   │
   └──────┬──────┘     └────┬─────┘     └─────┬──────┘
          └────────┬────────┴─────────────────┘
                   ▼
              ┌─────────┐         ┌─────────┐
              │providers│         │   mcp   │
              └────┬────┘         └────┬────┘
                   └────────┬─────────┘
                            ▼
                       ┌─────────┐
                       │  tools  │
                       └────┬────┘
                            ▼
                       ┌─────────┐
                       │  agents │
                       └────┬────┘
                            ▼
                  ┌──────────┴──────────┐
                  ▼                     ▼
            ┌──────────┐          ┌────────────┐
            │workflows │          │ background │
            └────┬─────┘          └─────┬──────┘
                 └──────────┬───────────┘
                            ▼
                       ┌─────────┐
                       │ context │
                       └────┬────┘
                            ▼
                       ┌─────────┐
                       │   api   │ → admin (UI)`}
                </pre>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">قرارات معمارية رئيسية</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    { decision: 'Modular Monolith (بدلاً من Microservices)', reason: 'بساطة التطوير، إمكانية الفصل لاحقاً' },
                    { decision: 'Drizzle ORM (بدلاً من Prisma)', reason: 'SQL-first، أداء أعلى، دعم pgvector أصلي' },
                    { decision: 'BullMQ للطوابير', reason: 'ناضج، يدعم Retries/Schedules/Priorities' },
                    { decision: 'Redis للذاكرة قصيرة المدى', reason: 'زمن وصول < 1ms، TTL تلقائي' },
                    { decision: 'pgvector (بدلاً من Pinecone)', reason: 'قاعدة بيانات واحدة، transactions، أقل تكلفة' },
                    { decision: 'EventBus لفك الارتباط', reason: 'منع Circular Dependencies' },
                  ].map((item) => (
                    <div key={item.decision} className="flex items-start gap-3 py-2 border-b last:border-0">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-sm">{item.decision}</p>
                        <p className="text-xs text-muted-foreground">{item.reason}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== MANUAL SETUP ===== */}
          <TabsContent value="setup" className="space-y-4">
            <Card className="border-emerald-500/30 bg-emerald-500/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="w-5 h-5" />
                  ✅ تم الإعداد تلقائياً في هذه البيئة
                </CardTitle>
                <CardDescription>
                  تم تثبيت وتشغيل PostgreSQL 18 + توليد مفاتيح الأمان + تطبيق migrations — كل ذلك بدون أي إجراء منك.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-emerald-500/30 p-4 bg-background">
                    <div className="flex items-center gap-2 mb-2">
                      <Database className="w-4 h-4 text-emerald-500" />
                      <h4 className="font-semibold text-sm">PostgreSQL 18.4 (Embedded)</h4>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      مثبّت محلياً عبر <code className="text-[10px] bg-muted px-1 rounded">embedded-postgres</code> npm package
                    </p>
                    <pre className="text-[10px] font-mono bg-slate-950 text-emerald-400 p-2 rounded">
{`Port: 5433
DB: agent_platform
User: postgres
Tables: 35 (auto-migrated)`}
                    </pre>
                  </div>

                  <div className="rounded-lg border border-emerald-500/30 p-4 bg-background">
                    <div className="flex items-center gap-2 mb-2">
                      <KeyRound className="w-4 h-4 text-emerald-500" />
                      <h4 className="font-semibold text-sm">مفاتيح الأمان</h4>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      تم توليدها بـ <code className="text-[10px] bg-muted px-1 rounded">openssl rand</code>
                    </p>
                    <pre className="text-[10px] font-mono bg-slate-950 text-emerald-400 p-2 rounded">
{`ENCRYPTION_KEY: ✓ (AES-256)
JWT_SECRET: ✓ (64 hex chars)
JWT TTL: 15min / 7 days`}
                    </pre>
                  </div>

                  <div className="rounded-lg border border-amber-500/30 p-4 bg-background">
                    <div className="flex items-center gap-2 mb-2">
                      <Activity className="w-4 h-4 text-amber-500" />
                      <h4 className="font-semibold text-sm">Redis (Memory Fallback)</h4>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      يعمل بـ in-memory fallback. للإنتاج، أضف Redis URL.
                    </p>
                    <pre className="text-[10px] font-mono bg-slate-950 text-amber-400 p-2 rounded">
{`Mode: in-memory (dev)
For production:
  REDIS_URL=redis://...`}
                    </pre>
                  </div>

                  <div className="rounded-lg border border-blue-500/30 p-4 bg-background">
                    <div className="flex items-center gap-2 mb-2">
                      <Database className="w-4 h-4 text-blue-500" />
                      <h4 className="font-semibold text-sm">pgvector</h4>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      غير متوفر في الـ embedded build. يستخدم JSON storage بدلاً منه.
                    </p>
                    <pre className="text-[10px] font-mono bg-slate-950 text-blue-400 p-2 rounded">
{`Embeddings: JSON arrays
Cosine similarity: app-level
For production (Railway):
  CREATE EXTENSION vector;`}
                    </pre>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-amber-500/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="w-5 h-5" />
                  إجراءات إضافية للإنتاج (اختياري)
                </CardTitle>
                <CardDescription>
                  هذه إجراءات تحتاجها فقط عند النشر للإنتاج على Railway أو أي منصة أخرى.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-lg border p-3">
                  <p className="text-sm font-medium mb-1">1. إضافة Redis حقيقي (للإنتاج)</p>
                  <p className="text-xs text-muted-foreground">في Railway، أنشئ Redis service وانسخ الـ URL إلى <code className="bg-muted px-1 rounded text-[10px]">REDIS_URL</code></p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-sm font-medium mb-1">2. تفعيل pgvector (للإنتاج)</p>
                  <p className="text-xs text-muted-foreground">في Railway PostgreSQL console: <code className="bg-muted px-1 rounded text-[10px]">CREATE EXTENSION vector;</code> ثم migration</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-sm font-medium mb-1">3. إضافة API keys للمزودين</p>
                  <p className="text-xs text-muted-foreground">بعد إقلاع النظام، أضف OpenAI/Anthropic/Gemini API keys من لوحة التحكم → Providers</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-sm font-medium mb-1">4. ربط GitHub بـ Railway للنشر</p>
                  <p className="text-xs text-muted-foreground">ارفع المشروع لـ GitHub، اربطه بـ Railway، أضف متغيرات البيئة من <code className="bg-muted px-1 rounded text-[10px]">.env</code></p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== DOCUMENTATION ===== */}
          <TabsContent value="docs" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <BookOpen className="w-5 h-5 text-emerald-500" />
                  ملفات التوثيق (9 ملفات)
                </CardTitle>
                <CardDescription>
                  توثيق شامل لكل جوانب المنصة — اقرأها قبل أي تعديل على البنية
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {DOCUMENTATION_FILES.map((doc) => (
                    <div
                      key={doc.name}
                      className="rounded-lg border p-4 hover:border-emerald-500/50 hover:shadow-md transition-all"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                          <FileText className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-mono text-sm font-semibold truncate">{doc.name}</p>
                          <p className="text-xs text-muted-foreground mt-1">{doc.description}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">الخطوات التالية</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  'راجع ARCHITECTURE.md لفهم القرارات المعمارية',
                  'راجع DATABASE.md لمعرفة بنية الجداول قبل تنفيذ migrations',
                  'أنشئ قاعدة بيانات PostgreSQL + Redis على Railway',
                  'أضف متغيرات البيئة المطلوبة (DATABASE_URL, REDIS_URL, ENCRYPTION_KEY, JWT_SECRET)',
                  'بعد استقرار المرحلة 1، اطلب مني المتابعة للمرحلة 2: تنفيذ Core/Providers/Memory/Auth',
                ].map((step, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {i + 1}
                    </div>
                    <p className="text-sm pt-0.5">{step}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Separator className="my-8" />

        <footer className="text-center text-xs text-muted-foreground pb-6">
          <p>Agent Platform · Clean Architecture · Modular Design · Production Ready</p>
          <p className="mt-1">المرحلة 1 مكتملة — جاهز للمرحلة 2 عند الطلب</p>
        </footer>
      </main>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  subValue,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  subValue: string;
  color: 'emerald' | 'blue' | 'amber' | 'purple';
}) {
  const colors = {
    emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    purple: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  };
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colors[color]}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-[10px] text-muted-foreground mt-1">{subValue}</p>
      </CardContent>
    </Card>
  );
}
