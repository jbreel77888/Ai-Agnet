/**
 * AgentRouter — Dynamic task-to-agent classifier.
 * ─────────────────────────────────────────────────────────────────────────────
 * Given a user's message, picks the most suitable specialist agent
 * (planner, research, reasoning, coding, execution, tool, memory,
 *  reflection, summarizer) to handle it.
 *
 * The router uses a hybrid strategy:
 *   1. Keyword/pattern matching against agent specialty vocabularies
 *   2. Intent detection (question vs command vs analysis vs creation)
 *   3. Tool-required detection (does the task need a specific tool?)
 *   4. Confidence scoring — falls back to `planner` for ambiguous tasks
 *
 * The router is SYNCHRONOUS and CHEAP — no LLM call needed. It runs in
 * <1ms. For complex multi-step tasks, the planner agent can later
 * spawn/handoff to specialists using its own LLM-based judgement.
 *
 * Output shape:
 *   {
 *     agentSlug: 'coding',                 // the chosen agent
 *     agentName: 'Coding',
 *     confidence: 0.85,                    // 0..1
 *     reason: 'matched coding keywords',   // human-readable
 *     alternatives: [                      // other candidates considered
 *       { slug: 'execution', score: 0.4 },
 *       ...
 *     ]
 *   }
 */

// ─────────────────────────────────────────────────────────────────────────────
// Agent specialty vocabularies (English + Arabic keywords)
// ─────────────────────────────────────────────────────────────────────────────
interface AgentVocab {
  slug: string;
  name: string;
  keywords: string[];      // direct keyword matches
  patterns: RegExp[];      // regex patterns for intent detection
  toolsPreferred?: string[]; // tools this agent naturally uses
  weight: number;          // base weight for this agent (0..1)
}

const AGENT_VOCABS: AgentVocab[] = [
  {
    slug: 'coding',
    name: 'Coding',
    weight: 1.0,
    keywords: [
      'code', 'function', 'class', 'method', 'script', 'program', 'bug', 'debug',
      'refactor', 'implement', 'algorithm', 'api', 'endpoint', 'compile', 'syntax',
      'typescript', 'javascript', 'python', 'java', 'go', 'rust', 'react', 'nextjs',
      'sql', 'html', 'css', 'json', 'yaml', 'regex', 'unit test', 'integration test',
      'كود', 'برمج', 'دالة', 'كلاس', 'خوارزمية', 'تصحيح', 'خطأ برمجي',
      'تنفيذ', 'كتابة كود', 'تعديل الكود', 'تطوير', 'برنامج',
    ],
    patterns: [
      /\b(write|create|generate|fix|debug|refactor|implement|optimize)\s+(a |an |the |some )?(function|class|method|component|script|program|api|endpoint|algorithm)\b/i,
      /\bcode\s+(block|snippet|sample|example)\b/i,
      /\b(how do I|how to)\s+(code|implement|write|debug|test)\b/i,
      /\b(خطأ|مشكلة)\s+(في|بـ)?\s*(الكود|البرنامج|الدالة)\b/i,
    ],
    toolsPreferred: ['code_execution'],
  },
  {
    slug: 'research',
    name: 'Research',
    weight: 0.95,
    keywords: [
      'research', 'search', 'find', 'investigate', 'gather', 'sources', 'cite',
      'study', 'survey', 'literature', 'paper', 'article', 'news', 'trends',
      'compare', 'comparison', 'benchmark', 'evaluate options',
      'بحث', 'ابحث', 'معلومات', 'مصادر', 'استقصاء', 'دراسة', 'مقارنة', 'اخبار',
      'تقرير', 'تتبع', 'جمع معلومات', 'ابحث عن',
    ],
    patterns: [
      /\b(find|search|look up|investigate)\s+(information|data|sources|facts|articles|papers|news)\b/i,
      /\bwhat('s| is| are)\s+(the|current|latest)\s+(news|trends|state|status)\b/i,
      /\b(ابحث|بحث)\s+(عن|في)\b/i,
    ],
    toolsPreferred: ['web_search', 'http_request', 'browser'],
  },
  {
    slug: 'reasoning',
    name: 'Reasoning',
    weight: 0.9,
    keywords: [
      'why', 'explain', 'reason', 'logic', 'prove', 'derive', 'analyze', 'analysis',
      'cause', 'effect', 'consequence', 'implication', 'deduce', 'infer',
      'compare', 'contrast', 'evaluate', 'assess', 'trade-off', 'tradeoffs',
      'لماذا', 'اشرح', 'تفسير', 'تحليل', 'برهن', 'استنتج', 'سبب', 'نتيجة',
      'مقارنة', 'تقييم', 'كيف', 'ما السبب',
    ],
    patterns: [
      /\b(why|how come)\s+(is|are|does|do|did|was|were)\b/i,
      /\b(explain|analyze|evaluate)\s+(the|how|why|what)\b/i,
      /\bwhat('s| is| are)\s+(the|a)\s+(cause|reason|consequence|implication)\b/i,
      /\b(لماذا|كيف)\s.+/i,
    ],
  },
  {
    slug: 'execution',
    name: 'Execution',
    weight: 0.85,
    keywords: [
      'run', 'execute', 'deploy', 'launch', 'start', 'stop', 'restart',
      'install', 'uninstall', 'build', 'compile', 'package', 'publish',
      'shell', 'command', 'terminal', 'cli', 'process',
      'شغل', 'نفذ', 'انشر', 'ابدأ', 'توقف', 'أعد التشغيل', 'تثبيت', 'بناء',
      'امر', 'اوامر', 'طرفية',
    ],
    patterns: [
      /\b(run|execute|deploy|launch|start|install|build)\s+(the|a|an)?\s*\w+/i,
      /\b(in terminal|in shell|in cli)\b/i,
    ],
    toolsPreferred: ['code_execution', 'http_request'],
  },
  {
    slug: 'tool',
    name: 'Tool',
    weight: 0.8,
    keywords: [
      'calculate', 'compute', 'math', 'arithmetic', 'equation', 'formula',
      'fetch', 'request', 'api call', 'http', 'curl', 'wget',
      'browser', 'open url', 'visit', 'scrape', 'crawl',
      'احسب', 'حساب', 'رياضيات', 'معادلة', 'جلب', 'استدعاء', 'استخرج',
    ],
    patterns: [
      /\b(calculate|compute|solve)\s+[\d\s+\-*/().^=]+/i,
      /\b(fetch|get|post|put|delete)\s+(from|to|url|http)\b/i,
      /\b(open|visit|browse)\s+(http|url|website|page)\b/i,
      /\b(احسب|حساب)\s.+/i,
    ],
    toolsPreferred: ['calculator', 'http_request', 'browser'],
  },
  {
    slug: 'memory',
    name: 'Memory',
    weight: 0.75,
    keywords: [
      'remember', 'recall', 'forget', 'store', 'save', 'note',
      'what did we', 'what did i', 'previously', 'earlier', 'last time',
      'history', 'past', 'memo',
      'تذكر', 'استرجع', 'انسى', 'خزن', 'احفظ', 'ملاحظة', 'سابقا', 'في الماضي',
      'آخر مرة', 'محفوظات',
    ],
    patterns: [
      /\b(remember|recall|note)\s+(that|to|the)?\b/i,
      /\b(what did we|what did i)\s+(talk|discuss|decide|say)\b/i,
      /\b(save|store)\s+(this|that|the)\b/i,
      /\b(تذكر|استرجع|احفظ)\b/i,
    ],
    toolsPreferred: ['memory_search', 'memory_store'],
  },
  {
    slug: 'summarizer',
    name: 'Summarizer',
    weight: 0.7,
    keywords: [
      'summarize', 'summary', 'brief', 'recap', 'overview', 'tl;dr',
      'condense', 'compress', 'shorten', 'key points', 'main points',
      'لخص', 'ملخص', 'اختصر', 'خلاصة', 'أبرز النقاط', 'النقاط الرئيسية',
    ],
    patterns: [
      /\b(summarize|summarise|recap|tl;?dr)\b/i,
      /\b(give|write|provide)\s+(me\s+)?(a\s+)?(summary|brief|overview|recap)\b/i,
      /\b(لخص|ملخص|اختصر|خلاصة)\b/i,
    ],
  },
  {
    slug: 'reflection',
    name: 'Reflection',
    weight: 0.65,
    keywords: [
      'review', 'reflect', 'evaluate', 'assess', 'critique', 'feedback',
      'improve', 'quality', 'issues', 'problems', 'mistakes',
      'self-check', 'verify', 'validate',
      'راجع', 'تقييم', 'نقد', 'ملاحظات', 'تحسين', 'جودة', 'مشاكل', 'اخطاء',
      'تحقق', 'مراجعة',
    ],
    patterns: [
      /\b(review|reflect on|evaluate|critique)\s+(the|my|this|that)\b/i,
      /\b(what's wrong|what is wrong|issues? with|problems? with)\b/i,
      /\b(راجع|تقييم|نقد)\b/i,
    ],
  },
  {
    slug: 'planner',
    name: 'Planner',
    weight: 0.85,
    keywords: [
      'plan', 'planning', 'strategy', 'roadmap', 'steps', 'phases',
      'project', 'organize', 'coordinate', 'manage', 'schedule',
      'multi-step', 'workflow', 'process', 'breakdown',
      'خطة', 'تخطيط', 'استراتيجية', 'مشروع', 'خطوات', 'مراحل', 'نظم', 'نظّم',
      'إدارة', 'جدول', 'سير عمل',
    ],
    patterns: [
      /\b(plan|outline|strategize)\s+(how|for|to)\b/i,
      /\b(help me|let's)\s+(plan|organize|coordinate|manage)\b/i,
      /\b(step[\s-]?by[\s-]?step|multi[\s-]?step)\b/i,
      /\b(خطة|تخطيط|خطوات)\b/i,
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────
export interface RoutingDecision {
  agentSlug: string;
  agentName: string;
  confidence: number;          // 0..1
  reason: string;
  alternatives: Array<{ slug: string; name: string; score: number }>;
  detectedIntent: 'question' | 'command' | 'analysis' | 'creation' | 'multi_step' | 'general';
  detectedTools: string[];
}

function detectIntent(message: string): RoutingDecision['detectedIntent'] {
  const lower = message.toLowerCase();
  if (/\b(and then|after that|finally|next,|first,|step \d)\b/i.test(message) ||
      lower.split(/\s+/).length > 25) {
    return 'multi_step';
  }
  if (/\?\s*$/.test(message.trim()) || /^(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did)\b/i.test(message.trim())) {
    return 'question';
  }
  if (/^(ما|ماذا|لماذا|كيف|متى|اين|من|اي|هل|كم)\b/.test(message.trim())) {
    return 'question';
  }
  if (/^(write|create|make|build|generate|fix|debug|implement|run|execute|deploy|install|fetch|calculate|summarize|plan|design)\b/i.test(message.trim())) {
    return 'creation';
  }
  if (/^(اكتب|أنشئ|اصنع|ابن|صمم|نفذ|احسب|لخص|خطط|جهز)\b/i.test(message.trim())) {
    return 'creation';
  }
  if (/\b(analyze|evaluate|compare|assess|review|study)\b/i.test(lower)) {
    return 'analysis';
  }
  return 'general';
}

function detectTools(message: string): string[] {
  const tools: string[] = [];
  if (/\b(calculate|compute|\d+\s*[+\-*/x×÷]\s*\d+|equation|formula)\b/i.test(message)) tools.push('calculator');
  if (/\b(http|url|fetch|api call|webhook)\b/i.test(message)) tools.push('http_request');
  if (/\b(search|google|find online|web)\b/i.test(message)) tools.push('web_search');
  if (/\b(browser|click|visit website|scrape)\b/i.test(message)) tools.push('browser');
  if (/\b(remember|recall|memory|save this|note this)\b/i.test(message)) tools.push('memory_store', 'memory_search');
  if (/\b(run code|execute code|python|javascript|typescript script|repl)\b/i.test(message)) tools.push('code_execution');
  return tools;
}

function scoreAgent(message: string, vocab: AgentVocab, intent: RoutingDecision['detectedIntent'], detectedTools: string[]): number {
  const lower = message.toLowerCase();
  let score = 0;

  let keywordHits = 0;
  for (const kw of vocab.keywords) {
    const kwLower = kw.toLowerCase();
    if (/[\u0600-\u06FF]/.test(kw)) {
      const idx = lower.indexOf(kwLower);
      if (idx >= 0) {
        keywordHits++;
        if (idx < 20) score += 0.15;
        else score += 0.08;
      }
    } else {
      const re = new RegExp(`\\b${kwLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(message)) {
        keywordHits++;
        score += 0.1;
      }
    }
  }
  if (keywordHits > 5) score = score - (keywordHits - 5) * 0.05;

  for (const pattern of vocab.patterns) {
    if (pattern.test(message)) {
      score += 0.3;
    }
  }

  if (vocab.toolsPreferred && detectedTools.length > 0) {
    const overlap = detectedTools.filter(t => vocab.toolsPreferred!.includes(t)).length;
    if (overlap > 0) {
      score += 0.2 * overlap;
    }
  }

  if (intent === 'multi_step' && vocab.slug === 'planner') score += 0.25;
  if (intent === 'analysis' && (vocab.slug === 'reasoning' || vocab.slug === 'reflection')) score += 0.15;
  if (intent === 'creation' && vocab.slug === 'coding') score += 0.15;

  score *= vocab.weight;

  return Math.min(score, 1.0);
}

export function routeMessage(message: string): RoutingDecision {
  const trimmed = message.trim();
  if (!trimmed) {
    return {
      agentSlug: 'planner',
      agentName: 'Planner',
      confidence: 0.5,
      reason: 'empty message — defaulting to planner',
      alternatives: [],
      detectedIntent: 'general',
      detectedTools: [],
    };
  }

  const intent = detectIntent(trimmed);
  const detectedTools = detectTools(trimmed);

  const scored = AGENT_VOCABS.map(v => ({
    slug: v.slug,
    name: v.name,
    score: scoreAgent(trimmed, v, intent, detectedTools),
  })).sort((a, b) => b.score - a.score);

  const top = scored[0];
  const second = scored[1];

  const PLANNER_THRESHOLD = 0.15;
  if (top.score < PLANNER_THRESHOLD) {
    return {
      agentSlug: 'planner',
      agentName: 'Planner',
      confidence: 0.5,
      reason: `no strong specialty match (top was ${top.slug} at ${top.score.toFixed(2)}) — using universal planner`,
      alternatives: scored.slice(0, 3).map(s => ({ slug: s.slug, name: s.name, score: s.score })),
      detectedIntent: intent,
      detectedTools,
    };
  }

  const margin = top.score - (second?.score || 0);
  const confidence = Math.min(0.5 + margin + top.score * 0.5, 0.98);

  return {
    agentSlug: top.slug,
    agentName: top.name,
    confidence,
    reason: `matched ${top.slug} specialty (score ${top.score.toFixed(2)}, margin ${margin.toFixed(2)} over ${second?.slug || 'none'})`,
    alternatives: scored.slice(0, 3).map(s => ({ slug: s.slug, name: s.name, score: s.score })),
    detectedIntent: intent,
    detectedTools,
  };
}

export function listAvailableAgents(): Array<{ slug: string; name: string }> {
  return AGENT_VOCABS.map(v => ({ slug: v.slug, name: v.name }));
}
