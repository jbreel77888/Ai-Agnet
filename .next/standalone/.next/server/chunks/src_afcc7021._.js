module.exports=[641072,e=>{"use strict";let t=[{name:"Planner",slug:"planner",type:"planner",description:"Analyzes tasks and creates execution plans. Decides which agents to invoke.",systemPrompt:`You are the Planner Agent. Your role is to:
1. Analyze the user's request carefully
2. Break down complex tasks into clear, ordered steps
3. Decide which specialized agents should handle each step
4. Consider dependencies between steps
5. Estimate time and resources needed

Always output your plan in this format:
## Plan
1. [Step description] → [Agent: planner|research|reasoning|coding|execution|tool|memory|reflection|summarizer]
2. ...

## Considerations
- [Any risks, dependencies, or notes]

Be concise but thorough. Think before you write.`,temperature:.4,maxTokens:2048,enabled:!0,canSpawnSubagents:!0,maxSubagents:5,handoffTargets:["research","reasoning","coding","execution"]},{name:"Research",slug:"research",type:"research",description:"Gathers information from web, files, and memory. Returns structured findings.",systemPrompt:`You are the Research Agent. Your role is to:
1. Search for relevant information using available tools
2. Verify facts across multiple sources when possible
3. Synthesize findings into clear, structured summaries
4. Always cite your sources (URL or document name)
5. Note any uncertainties or conflicting information

Use the web_search tool for current information. Use memory_search to recall past findings.

Return your findings in this format:
## Findings
- [Fact 1] (source: [URL/document])
- [Fact 2] (source: [URL/document])

## Summary
[2-3 sentence summary]

## Confidence
[High/Medium/Low — explain why]`,temperature:.3,maxTokens:4096,enabled:!0,canSpawnSubagents:!1,maxSubagents:0,handoffTargets:["reasoning","summarizer"]},{name:"Reasoning",slug:"reasoning",type:"reasoning",description:"Performs logical analysis, draws conclusions, solves problems step-by-step.",systemPrompt:`You are the Reasoning Agent. Your role is to:
1. Analyze information logically and systematically
2. Identify assumptions, constraints, and edge cases
3. Draw well-supported conclusions
4. Consider alternative perspectives
5. Explain your reasoning step by step

Use "Chain of Thought" — think out loud before giving your conclusion.

Format:
## Analysis
[Step-by-step reasoning]

## Conclusion
[Clear answer based on the analysis]

## Confidence
[High/Medium/Low]`,temperature:.2,maxTokens:4096,enabled:!0,canSpawnSubagents:!1,maxSubagents:0,handoffTargets:["coding","execution"]},{name:"Coding",slug:"coding",type:"coding",description:"Writes, reviews, and refactors code. Explains technical decisions.",systemPrompt:`You are the Coding Agent. Your role is to:
1. Write clean, well-documented code following best practices
2. Choose appropriate patterns and data structures
3. Handle errors and edge cases
4. Add tests when appropriate
5. Explain significant technical decisions

Always wrap code in proper markdown code blocks with language identifiers.

For each solution, include:
\`\`\`language
// code here
\`\`\`

## Notes
- [Key decisions and trade-offs]
- [Edge cases handled]
- [Things to test]`,temperature:.2,maxTokens:8192,enabled:!0,canSpawnSubagents:!1,maxSubagents:0,handoffTargets:["execution","reflection"]},{name:"Execution",slug:"execution",type:"execution",description:"Executes commands, runs code, manages processes. Reports results.",systemPrompt:`You are the Execution Agent. Your role is to:
1. Execute commands and code safely
2. Capture and report output accurately
3. Handle errors gracefully
4. Clean up resources after execution
5. Report timing and resource usage

Always confirm before executing potentially destructive operations.

Format:
## Command
\`\`\`bash
[command]
\`\`\`

## Output
\`\`\`
[output]
\`\`\`

## Status
[Success/Failed/Partial] — [explanation]`,temperature:.1,maxTokens:4096,enabled:!0,canSpawnSubagents:!1,maxSubagents:0,handoffTargets:["reflection"]},{name:"Tool",slug:"tool",type:"tool",description:"Selects and invokes the right tools. Manages tool lifecycle.",systemPrompt:`You are the Tool Agent. Your role is to:
1. Understand what tool is needed for a given task
2. Validate inputs before calling tools
3. Call tools with correct parameters
4. Parse and interpret tool results
5. Handle tool errors and timeouts gracefully

Always explain which tool you're using and why, then show the result.

Format:
## Tool: [name]
Reason: [why this tool]
Arguments: \`{...}\`

## Result
[parsed result]

## Next Steps
[what to do with this result]`,temperature:.2,maxTokens:4096,enabled:!0,canSpawnSubagents:!1,maxSubagents:0,handoffTargets:[]},{name:"Memory",slug:"memory",type:"memory",description:"Stores and retrieves information from long-term memory.",systemPrompt:`You are the Memory Agent. Your role is to:
1. Store important facts, entities, and events in long-term memory
2. Retrieve relevant memories when needed
3. Maintain and update entity relationships
4. Detect and handle memory conflicts
5. Compress and summarize old memories

Use memory_store to save facts and memory_search to retrieve them.

Format:
## Memory Operation
[store/search/update/delete]

## Details
[what was stored/retrieved]

## Relevance
[why this matters for the current task]`,temperature:.3,maxTokens:2048,enabled:!0,canSpawnSubagents:!1,maxSubagents:0,handoffTargets:[]},{name:"Reflection",slug:"reflection",type:"reflection",description:"Reviews outputs, evaluates quality, suggests improvements.",systemPrompt:`You are the Reflection Agent. Your role is to:
1. Review outputs from other agents critically
2. Identify errors, gaps, or improvements
3. Suggest specific, actionable improvements
4. Verify correctness against requirements
5. Decide if the work is complete or needs revision

Format:
## Review
[Overall assessment]

## Issues Found
1. [Issue] — [Severity: High/Medium/Low] — [Suggested fix]
2. ...

## Verdict
[Pass / Needs Revision / Reject]

## Next Steps
[What should happen next]`,temperature:.3,maxTokens:2048,enabled:!0,canSpawnSubagents:!1,maxSubagents:0,handoffTargets:["planner","coding"]},{name:"Summarizer",slug:"summarizer",type:"summarizer",description:"Compresses long conversations and documents into concise summaries.",systemPrompt:`You are the Summarizer Agent. Your role is to:
1. Compress long conversations while preserving key information
2. Extract action items and decisions
3. Identify entities mentioned
4. Note any unresolved questions
5. Keep summaries concise but complete

Format:
## Summary
[2-4 sentence summary]

## Key Points
- [Point 1]
- [Point 2]
...

## Decisions Made
- [Decision 1]
...

## Action Items
- [ ] [Action 1]
- [ ] [Action 2]

## Open Questions
- [Question 1]`,temperature:.4,maxTokens:2048,enabled:!0,canSpawnSubagents:!1,maxSubagents:0,handoffTargets:[]}];e.s(["DEFAULT_AGENTS",0,t])},932534,e=>{"use strict";class t{name="calculator";description="Perform mathematical calculations. Supports +, -, *, /, parentheses, ^ (power), %, and common Math functions (sqrt, sin, cos, log, etc.).";category="builtin";schema={type:"object",properties:{expression:{type:"string",description:'Mathematical expression to evaluate (e.g. "2 + 3 * 4", "sqrt(16) + log(100)", "Math.PI * 2")'}},required:["expression"],additionalProperties:!1};validate(e){return e?.expression?"string"!=typeof e.expression?{valid:!1,errors:["expression must be a string"]}:e.expression.length>500?{valid:!1,errors:["expression too long (max 500 chars)"]}:/^[0-9+\-*/().,%\s]*(Math\.(PI|E|LN2|LN10|LOG2E|LOG10E|SQRT2|sqrt|cbrt|abs|sign|ceil|floor|round|trunc|exp|log|log2|log10|pow|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|min|max|hypot|random|floor|cbrt|expm1|log1p|clz32|fround|imul))*[0-9+\-*/().,%\s]*$/i.test(e.expression)?{valid:!0}:{valid:!1,errors:["Expression contains disallowed characters or functions"]}:{valid:!1,errors:["expression is required"]}}async execute(e,t){try{let t=Function("Math",`"use strict"; return (${e.expression})`)(Math);if("number"!=typeof t||!isFinite(t))return{success:!1,error:{code:"INVALID_RESULT",message:`Not a valid number: ${t}`}};return{success:!0,data:{result:t,expression:e.expression}}}catch(e){return{success:!1,error:{code:"EVAL_ERROR",message:e.message}}}}}class s{name="http_request";description="Make an HTTP request to any public URL. Returns status, headers, and body. Blocks private/internal IPs for security (SSRF protection).";category="builtin";schema={type:"object",properties:{url:{type:"string",description:"The URL to request (must be http(s)://)"},method:{type:"string",enum:["GET","POST","PUT","PATCH","DELETE"],default:"GET"},headers:{type:"object"},body:{type:"string"},timeoutMs:{type:"integer",default:1e4,description:"Request timeout in milliseconds (max 30000)"}},required:["url"],additionalProperties:!1};isPrivateHost(e){let t=e.toLowerCase().trim();if("localhost"===t||"0.0.0.0"===t||"::1"===t||t.endsWith(".internal")||t.endsWith(".local")||t.endsWith(".railway.internal"))return!0;let s=t.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);if(s){let[,e,t]=s.map(Number);if(0===e||10===e||127===e||169===e&&254===t||172===e&&t>=16&&t<=31||192===e&&168===t)return!0}return!!("::1"===t||"::"===t||"::ffff:127.0.0.1"===t||t.startsWith("fc")||t.startsWith("fd")||t.startsWith("fe80")||t.startsWith("fe90")||t.startsWith("fea0")||t.startsWith("feb0")||t.startsWith("fec0"))}validate(e){let t;if(!e?.url)return{valid:!1,errors:["url is required"]};try{t=new URL(e.url)}catch{return{valid:!1,errors:["Invalid URL"]}}return["http:","https:"].includes(t.protocol)?this.isPrivateHost(t.hostname)?{valid:!1,errors:[`Blocked: '${t.hostname}' is a private/internal address (SSRF protection)`]}:e.timeoutMs&&(e.timeoutMs<1e3||e.timeoutMs>3e4)?{valid:!1,errors:["timeoutMs must be between 1000 and 30000"]}:{valid:!0}:{valid:!1,errors:["Only http(s):// URLs are allowed"]}}async execute(e,t){try{let t=new URL(e.url);if(this.isPrivateHost(t.hostname))return{success:!1,error:{code:"SSRF_BLOCKED",message:`Blocked: '${t.hostname}' is a private/internal address`}};let s=Math.min(e.timeoutMs||1e4,3e4),r=await fetch(e.url,{method:e.method||"GET",headers:e.headers,body:e.body,signal:AbortSignal.timeout(s)}),o=await r.text(),a=o;try{a=JSON.parse(o)}catch{}return{success:!0,data:{status:r.status,statusText:r.statusText,headers:Object.fromEntries(r.headers.entries()),body:a,bodyLength:o.length}}}catch(e){return{success:!1,error:{code:"HTTP_ERROR",message:e.message}}}}}class r{name="memory_search";description="Search long-term memory using SEMANTIC similarity (vector embeddings). Finds facts that are conceptually related to the query, not just keyword matches. Returns ranked results with similarity scores.";category="builtin";schema={type:"object",properties:{query:{type:"string",description:"What to search for in memory"},topK:{type:"integer",minimum:1,maximum:20,default:5},minScore:{type:"number",minimum:0,maximum:1,default:.3}},required:["query"],additionalProperties:!1};validate(e){return e?.query?"string"!=typeof e.query?{valid:!1,errors:["query must be a string"]}:e.query.length>2e3?{valid:!1,errors:["query too long (max 2000 chars)"]}:{valid:!0}:{valid:!1,errors:["query required"]}}async execute(t,s){try{let r=t.topK||5,o=t.minScore??.3,{embedText:a,embeddingToPgVector:n}=await e.A(55769),i=await a(t.query),{Pool:l}=e.r(755168),c=new l({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5e3});try{let e;if(i){let t=n(i);for(let a of e=(await c.query(`SELECT id, fact, fact_type, importance,
                    1 - (embedding_vec <=> $1::vector) AS score,
                    last_accessed_at, created_at
             FROM memory_long
             WHERE embedding_vec IS NOT NULL
               ${s.userId?"AND user_id = $2":""}
             ORDER BY embedding_vec <=> $1::vector
             LIMIT $${s.userId?"3":"2"}`,s.userId?[t,s.userId,r]:[t,r])).rows.filter(e=>parseFloat(e.score)>=o))await c.query("UPDATE memory_long SET access_count = access_count + 1, last_accessed_at = NOW() WHERE id = $1",[a.id]).catch(()=>{})}else e=(await c.query(`SELECT id, fact, fact_type, importance,
                    CASE WHEN fact ILIKE '%' || $1 || '%' THEN 0.5 ELSE 0.1 END AS score,
                    last_accessed_at, created_at
             FROM memory_long
             WHERE ${s.userId?"user_id = $2 AND ":""}fact ILIKE '%' || $1 || '%'
             ORDER BY created_at DESC
             LIMIT $${s.userId?"3":"2"}`,s.userId?[t.query,s.userId,r]:[t.query,r])).rows;return{success:!0,data:{results:e.map(e=>({fact:e.fact,type:e.fact_type,importance:parseFloat(e.importance),score:parseFloat(e.score)})),count:e.length,query:t.query,searchMode:i?"semantic":"keyword"}}}finally{await c.end()}}catch(e){return{success:!1,error:{code:"MEMORY_ERROR",message:e.message}}}}}class o{name="memory_store";description="Store a fact in long-term memory for future reference. The fact is embedded using OpenAI text-embedding-3-small for semantic search. Use this to remember user preferences, important entities, or key information.";category="builtin";schema={type:"object",properties:{fact:{type:"string"},type:{type:"string",enum:["preference","entity","event","summary","custom"],default:"custom"},importance:{type:"number",default:.5}},required:["fact"],additionalProperties:!1};validate(e){return e?.fact?"string"!=typeof e.fact?{valid:!1,errors:["fact must be a string"]}:e.fact.length>5e3?{valid:!1,errors:["fact too long (max 5000 chars)"]}:{valid:!0}:{valid:!1,errors:["fact required"]}}async execute(t,s){try{let r=null;try{let{embedText:s}=await e.A(55769);r=await s(t.fact)}catch(e){console.warn("[memory_store] Embedding generation failed:",e.message)}let{Pool:o}=e.r(755168),a=new o({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5e3});try{let o=(await a.query(`INSERT INTO memory_long (user_id, agent_id, session_id, fact, fact_type, importance)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, fact`,[s.userId||null,s.agentId||null,s.sessionId||null,t.fact,t.type||"custom",(t.importance??.5).toString()])).rows[0];if(r&&o){let{embeddingToPgVector:t}=await e.A(55769),s=t(r);await a.query(`UPDATE memory_long
             SET embedding = $1, embedding_model = $2, embedding_vec = $3::vector
             WHERE id = $4`,[JSON.stringify(r),"text-embedding-3-small",s,o.id])}return{success:!0,data:{id:o.id,fact:o.fact,embedded:!!r,embeddingModel:r?"text-embedding-3-small":null}}}finally{await a.end()}}catch(e){return{success:!1,error:{code:"MEMORY_ERROR",message:e.message}}}}}class a{name="web_search";description="Search the web (fallback DuckDuckGo — limited results). When TAVILY_API_KEY is set, the TavilySearchTool is registered instead.";category="builtin";schema={type:"object",properties:{query:{type:"string"},max_results:{type:"integer",default:5}},required:["query"],additionalProperties:!1};validate(e){return e?.query?{valid:!0}:{valid:!1,errors:["query required"]}}async execute(e,t){let s=e.max_results||5;try{let t=await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(e.query)}&format=json&no_html=1`,{signal:AbortSignal.timeout(1e4)}),r=await t.json(),o=[];if(r.AbstractText&&o.push({title:r.Heading||e.query,url:r.AbstractURL||"",content:r.AbstractText}),r.RelatedTopics)for(let e of r.RelatedTopics.slice(0,s-o.length))e.Text&&e.FirstURL&&o.push({title:e.Text.substring(0,80),url:e.FirstURL,content:e.Text});return{success:!0,data:{results:o,count:o.length}}}catch(e){return{success:!1,error:{code:"SEARCH_ERROR",message:e.message}}}}}async function n(){let{getToolRegistry:n}=e.r(415222),i=n();if(i.register(new t),i.register(new s),i.register(new r),i.register(new o),process.env.TAVILY_API_KEY)try{let t=await e.A(416067);i.register(new t.TavilySearchTool),console.log("[tools] Registered Tavily web_search")}catch(e){console.warn("[tools] Tavily load failed, using DuckDuckGo:",e.message),i.register(new a)}else i.register(new a);try{let t=await e.A(991839);i.register(new t.WebScrapeTool),console.log("[tools] Registered web_scrape (Jina Reader)")}catch(e){console.warn("[tools] web_scrape registration failed:",e.message)}if(process.env.OPENAI_API_KEY)try{let t=await e.A(178136);i.register(new t.RagIngestTool),i.register(new t.RagQueryTool),console.log("[tools] Registered rag_ingest + rag_query (semantic search)")}catch(e){console.warn("[tools] RAG tools registration failed:",e.message)}else console.log("[tools] RAG tools skipped (no OPENAI_API_KEY for embeddings)");if(process.env.TENSORLAKE_API_KEY){try{let t=await e.A(49967);i.register(new t.TensorlakeSandboxTool),console.log("[tools] Registered code_execution (Tensorlake stateful)")}catch(e){console.warn("[tools] Tensorlake code_execution failed:",e.message)}try{let t=await e.A(178173);i.register(new t.FileManagerTool),console.log("[tools] Registered file_manager")}catch(e){console.warn("[tools] file_manager registration failed:",e.message)}try{let t=await e.A(658871);i.register(new t.ShellTool),console.log("[tools] Registered shell")}catch(e){console.warn("[tools] shell registration failed:",e.message)}}else console.log("[tools] Sandbox tools skipped (no TENSORLAKE_API_KEY)");try{let t=await e.A(348645);i.register(new t.BrowserTool)}catch(e){console.warn("[tools] Browser tool not registered:",e.message)}try{let{GitHubIntegration:t}=await e.A(680950),s=new t;i.register({name:"github",description:"Interact with GitHub: list repos, issues, create issues, get files",category:"integration",schema:{type:"object",properties:{action:{type:"string",enum:["list_repos","list_issues","create_issue","get_file"]},owner:{type:"string"},repo:{type:"string"},title:{type:"string"},body:{type:"string"},path:{type:"string"},branch:{type:"string"},username:{type:"string"}},required:["action"]},validate:e=>({valid:!!e?.action}),execute:async e=>{switch(e.action){case"list_repos":return s.listRepos(e.username);case"list_issues":return s.listIssues(e.owner,e.repo);case"create_issue":return s.createIssue(e.owner,e.repo,e.title,e.body||"");case"get_file":return s.getFile(e.owner,e.repo,e.path,e.branch);default:return{success:!1,error:{code:"UNKNOWN",message:`Unknown action: ${e.action}`}}}},initialize:async()=>{},shutdown:async()=>{}})}catch{}let l=i.list().length;console.log(`[tools] Registered ${l} tools`)}e.s(["CalculatorTool",()=>t,"HttpRequestTool",()=>s,"MemorySearchTool",()=>r,"MemoryStoreTool",()=>o,"WebSearchTool",()=>a,"registerBuiltinTools",()=>n])},813070,e=>e.a(async(t,s)=>{try{var r=e.i(83983),o=e.i(418954),a=e.i(280833),n=e.i(844438),i=e.i(318473),l=e.i(658719),c=t([r,o,a,n,i,l]);[r,o,a,n,i,l]=c.then?(await c)():c;class u{jobs=[];running=!1;timer=null;register(e,t,s){this.jobs.push({name:e,intervalMs:t,lastRun:0,fn:s}),console.log(`[scheduler] Registered job: ${e} (every ${t/1e3}s)`)}start(){this.running||(this.running=!0,console.log(`[scheduler] Started with ${this.jobs.length} jobs`),this.timer=setInterval(()=>this.tick(),3e4))}stop(){this.running=!1,this.timer&&(clearInterval(this.timer),this.timer=null),console.log("[scheduler] Stopped")}async tick(){let e=Date.now();for(let t of this.jobs)if(e-t.lastRun>=t.intervalMs)try{await t.fn(),t.lastRun=e}catch(s){console.error(`[scheduler] Job "${t.name}" failed:`,s),t.lastRun=e}}async runNow(e){let t=this.jobs.find(t=>t.name===e);if(!t)return!1;try{return await t.fn(),t.lastRun=Date.now(),!0}catch(t){return console.error(`[scheduler] Manual run of "${e}" failed:`,t),!1}}listJobs(){return this.jobs.map(e=>({name:e.name,intervalMs:e.intervalMs,lastRun:e.lastRun>0?new Date(e.lastRun):null}))}}let m=null;function d(){var e;return m||((e=m=new u).register("memory_decay",864e5,async()=>{try{await r.db.update(n.memoryLong).set({importance:l.sql`${n.memoryLong.importance} * 0.95`}).where(l.sql`${n.memoryLong.lastAccessedAt} < NOW() - INTERVAL '7 days' AND ${n.memoryLong.importance} > 0.1`),console.log("[scheduler] ✓ Memory decay applied")}catch(e){console.error("[scheduler] Memory decay failed:",e)}}),e.register("session_cleanup",36e5,async()=>{try{await r.db.update(a.agentSessions).set({status:"archived"}).where(l.sql`${a.agentSessions.lastActivityAt} < NOW() - INTERVAL '24 hours' AND ${a.agentSessions.status} = 'active'`),console.log("[scheduler] ✓ Session cleanup done")}catch(e){console.error("[scheduler] Session cleanup failed:",e)}}),e.register("budget_reset",36e5,async()=>{try{await r.db.update(i.costBudgets).set({spentUsd:"0"}).where(l.sql`${i.costBudgets.resetAt} IS NOT NULL AND ${i.costBudgets.resetAt} < NOW() AND ${i.costBudgets.enabled} = true`),console.log("[scheduler] ✓ Budget reset checked")}catch(e){console.error("[scheduler] Budget reset failed:",e)}})),m}e.s(["getScheduler",()=>d]),s()}catch(e){s(e)}},!1),296400,e=>{"use strict";async function t(){try{{console.log("[instrumentation:node] Production mode — using external DATABASE_URL");let e=process.env.DATABASE_URL;if(!e)return void console.error("[instrumentation:node] DATABASE_URL not set!");await r(e),await s(e)}}catch(e){console.error("[instrumentation:node] FATAL:",e?.message||e,e?.stack||""),console.error("[instrumentation:node] Continuing despite error (production mode)")}}async function s(t){let s=new(e.r(755168)).Client(t);await s.connect();try{let t=await s.query("SELECT count(*) FROM information_schema.tables WHERE table_name='users'");if(0===parseInt(t.rows[0].count,10))return void console.log("[instrumentation:node] Users table not found — skipping seed");for(let e of(console.log("[instrumentation:node] Running idempotent seed..."),[{name:"admin",description:"Full system access"},{name:"operator",description:"Manage agents, tools, sessions"},{name:"user",description:"Use the platform only"}]))await s.query("INSERT INTO roles (name, description, is_system) VALUES ($1, $2, true) ON CONFLICT (name) DO NOTHING",[e.name,e.description]);for(let e of(console.log("[instrumentation:node] ✓ Roles ensured"),["providers:read","providers:write","providers:delete","models:read","models:write","agents:read","agents:write","agents:delete","tools:read","tools:write","tools:execute","mcp:read","mcp:write","sessions:read","sessions:write","memory:read","memory:write","workflows:read","workflows:write","workflows:execute","users:read","users:write","roles:read","roles:write","logs:read","traces:read","audit:read","costs:read","costs:write"])){let[t,r]=e.split(":");await s.query("INSERT INTO permissions (name, resource, action, description) VALUES ($1, $2, $3, $4) ON CONFLICT (name) DO NOTHING",[e,t,r,`${r} ${t}`])}for(let e of(console.log("[instrumentation:node] ✓ Permissions created"),await s.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r, permissions p
      WHERE r.name = 'admin'
      ON CONFLICT DO NOTHING
    `),["agents:read","agents:write","tools:read","tools:execute","mcp:read","mcp:write","sessions:read","sessions:write","memory:read","memory:write","workflows:read","workflows:write","workflows:execute","models:read","providers:read","logs:read","traces:read","costs:read"]))await s.query(`
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id FROM roles r, permissions p
        WHERE r.name = 'operator' AND p.name = $1
        ON CONFLICT DO NOTHING
      `,[e]);for(let e of["sessions:read","sessions:write","memory:read","memory:write","agents:read","tools:read","workflows:execute","costs:read"])await s.query(`
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id FROM roles r, permissions p
        WHERE r.name = 'user' AND p.name = $1
        ON CONFLICT DO NOTHING
      `,[e]);console.log("[instrumentation:node] ✓ Role permissions assigned");let{DEFAULT_AGENTS:r}=e.r(641072);for(let e of r)await s.query(`
        INSERT INTO agents (name, slug, type, description, system_prompt, temperature, max_tokens, top_p, enabled, can_spawn_subagents, max_subagents, handoff_targets)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 1.0, $8, $9, $10, $11)
        ON CONFLICT (slug) DO NOTHING
      `,[e.name,e.slug,e.type,e.description||null,e.systemPrompt,e.temperature.toString(),e.maxTokens,e.enabled,e.canSpawnSubagents,e.maxSubagents,JSON.stringify(e.handoffTargets||[])]);console.log(`[instrumentation:node] ✓ ${r.length} default agents created`);try{let{registerBuiltinTools:t}=e.r(932534);await t()}catch(e){console.error("[instrumentation:node] Failed to register tools:",e)}try{let{getScheduler:t}=e.r(813070);t().start(),console.log("[instrumentation:node] ✓ Scheduler started")}catch(e){console.error("[instrumentation:node] Scheduler failed:",e)}let o=e.r(254799),[a]=(await s.query("SELECT id FROM users WHERE email = 'admin@agent-platform.local'")).rows;if(a)console.log("[instrumentation:node] ✓ Admin user already exists");else{let e=o.randomBytes(16).toString("hex"),t=o.scryptSync("admin123",e,64).toString("hex"),r=`scrypt$${e}$${t}`;await s.query(`INSERT INTO users (email, password_hash, name, status) VALUES ($1, $2, $3, 'active')
         ON CONFLICT (email) DO NOTHING`,["admin@agent-platform.local",r,"System Admin"]),await s.query(`
        INSERT INTO user_roles (user_id, role_id)
        SELECT u.id, r.id FROM users u, roles r
        WHERE u.email = 'admin@agent-platform.local' AND r.name = 'admin'
        ON CONFLICT DO NOTHING
      `),console.log("[instrumentation:node] ✓ Default admin user created:"),console.log("    Email: admin@agent-platform.local"),console.log("    Password: admin123"),console.log("    ⚠️  Change password after first login!")}}catch(e){console.error("[instrumentation:node] Seed error:",e.message)}finally{await s.end()}}async function r(t){let s=e.r(814747),r=e.r(522734),o=e.r(254799),a=e.r(755168),n=s.join(process.cwd(),"src","db","migrations");if(!r.existsSync(n))return void console.warn("[instrumentation:node] No migrations directory");let i=r.readdirSync(n).filter(e=>e.endsWith(".sql")).sort();if(0===i.length)return void console.warn("[instrumentation:node] No SQL migration files");let l=new a.Client(t);await l.connect();try{if(await l.query(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id serial PRIMARY KEY,
        hash text NOT NULL UNIQUE,
        created_at bigint NOT NULL
      );
    `),"true"===process.env.PG_RESET_ON_START){console.log("[instrumentation:node] PG_RESET_ON_START=true — clearing schema...");let e=await l.query(`
        SELECT tablename FROM pg_tables WHERE schemaname='public'
      `);for(let t of e.rows)await l.query(`DROP TABLE IF EXISTS "${t.tablename}" CASCADE`);console.log(`[instrumentation:node] Dropped ${e.rows.length} tables`),await l.query(`
        CREATE TABLE __drizzle_migrations (
          id serial PRIMARY KEY,
          hash text NOT NULL UNIQUE,
          created_at bigint NOT NULL
        );
      `)}else{let e=await l.query(`
        SELECT count(*) as c FROM pg_tables
        WHERE schemaname='public' AND tablename != '__drizzle_migrations'
      `),t=parseInt(e.rows[0].c,10),s=await l.query("SELECT count(*) as c FROM __drizzle_migrations");parseInt(s.rows[0].c,10)>0&&t<10&&(console.log(`[instrumentation:node] Migrations claim applied but only ${t} tables exist — forcing re-apply`),await l.query("DELETE FROM __drizzle_migrations"))}for(let e of i){let t=s.join(n,e),a=r.readFileSync(t,"utf-8"),i=o.createHash("sha256").update(a).digest("hex");if((await l.query("SELECT id FROM __drizzle_migrations WHERE hash = $1",[i])).rows.length>0){console.log(`[instrumentation:node] ✓ ${e} already applied`);continue}console.log(`[instrumentation:node] Applying: ${e}`);let c=a.replace(/--> statement-breakpoint/g,""),d=0,u=0;try{await l.query(c),d=c.split(";").filter(e=>e.trim()&&!e.trim().startsWith("--")).length,console.log(`[instrumentation:node] ✓ Applied all statements from ${e}`)}catch(e){for(let t of(console.log(`[instrumentation:node] Multi-statement failed (${e.message.substring(0,60)}), trying one-by-one...`),c.split(";").map(e=>e.trim()).filter(e=>e&&!e.startsWith("--"))))try{await l.query(t),d++}catch(e){!e.message.includes("already exists")&&++u<=5&&console.error(`  ✗ ${e.message.substring(0,100)}`)}}console.log(`[instrumentation:node] ✓ ${e}: ${d} ok, ${u} errors`),await l.query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ($1, $2)",[i,Date.now()])}let e=await l.query("SELECT count(*) FROM pg_tables WHERE schemaname='public'");console.log(`[instrumentation:node] ✓ Total tables: ${e.rows[0].count}`)}finally{await l.end()}}e.s(["registerNode",()=>t])}];

//# sourceMappingURL=src_afcc7021._.js.map