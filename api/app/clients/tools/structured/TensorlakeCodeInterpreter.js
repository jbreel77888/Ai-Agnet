/**
 * Tensorlake Code Interpreter — stateful sandbox execution for LibreChat.
 *
 * KEY DESIGN: Module-level sandbox cache (not instance-level).
 * LibreChat creates a new tool instance for every request, so an
 * instance-level Map would be empty every time.
 *
 * Also: Tensorlake free tier allows only 1 running sandbox.
 * So we reuse a SINGLE sandbox for ALL conversations.
 */
const { Tool } = require('@librechat/agents/langchain/tools');

// ── Module-level cache (survives tool instance recreation) ──────────────
let _sandbox = null; // The single sandbox instance
let _sandboxId = null;
let _sandboxLastUsed = 0;
const SANDBOX_TTL_MS = 30 * 60 * 1000; // 30 minutes idle → recreate

const tensorlakeSchema = {
  type: 'object',
  properties: {
    language: {
      type: 'string',
      enum: ['python', 'javascript', 'bash'],
      description: 'Programming language. Default: python.',
    },
    code: {
      type: 'string',
      description: 'REQUIRED. The code to execute. Write COMPLETE runnable code.',
    },
  },
  required: ['code'],
};

class TensorlakeCodeInterpreter extends Tool {
  static lc_name() {
    return 'TensorlakeCodeInterpreter';
  }

  static get jsonSchema() {
    return tensorlakeSchema;
  }

  constructor(fields = {}) {
    super(fields);
    this.name = 'tensorlake_code_interpreter';
    this.description =
      'YOUR PRIMARY TOOL — Use this for EVERY task that requires execution. ' +
      'Pass code in the "code" field (NOT cmd/shell/command). ' +
      'Supports: language="python" (default), language="javascript", language="bash". ' +
      'Persistent Linux sandbox — files, packages, and data survive across calls. ' +
      'Use for: writing code, running scripts, calculations, data analysis, ' +
      'generating files (CSV, JSON, HTML, images, charts), installing packages, ' +
      'building websites/apps, automating tasks. Working dir: /home/tl-user.';
    this.schema = tensorlakeSchema;
    this.envVar = 'TENSORLAKE_API_KEY';
    this.apiKey = fields[this.envVar] || process.env[this.envVar] || fields.TENSORLAKE_API_KEY;
    this._call = this._call.bind(this);
  }

  getApiKey() {
    if (this.apiKey) return this.apiKey;
    const key = process.env.TENSORLAKE_API_KEY;
    if (key) { this.apiKey = key; return key; }
    throw new Error('TENSORLAKE_API_KEY not found');
  }

  /**
   * Get or create the SINGLE sandbox.
   * Tensorlake free tier allows only 1 running sandbox.
   */
  async getSandbox() {
    // Check if cached sandbox is still alive and not expired
    if (_sandbox) {
      const idleTime = Date.now() - _sandboxLastUsed;
      if (idleTime < SANDBOX_TTL_MS) {
        try {
          await _sandbox.status();
          _sandboxLastUsed = Date.now();
          console.log(`[Tensorlake] Reusing sandbox ${_sandboxId}`);
          return _sandbox;
        } catch (err) {
          console.warn(`[Tensorlake] Cached sandbox dead: ${err.message}`);
          _sandbox = null;
        }
      } else {
        console.log(`[Tensorlake] Sandbox expired (idle ${Math.round(idleTime / 1000)}s)`);
        try { await _sandbox.terminate(); } catch (e) {}
        _sandbox = null;
      }
    }

    // Create new sandbox
    const apiKey = this.getApiKey();
    const { Sandbox } = require('tensorlake');
    const sandboxName = `lc-${Date.now().toString(36)}`;
    console.log(`[Tensorlake] Creating new sandbox ${sandboxName}...`);
    const sandbox = await Sandbox.create({
      apiKey,
      name: sandboxName,
      memoryMb: 1024,
      diskMb: 10000,
      vcpus: 1.0,
    });

    _sandbox = sandbox;
    _sandboxId = sandbox.sandboxId || sandbox.id || sandboxName;
    _sandboxLastUsed = Date.now();
    console.log(`[Tensorlake] Created sandbox ${_sandboxId}`);
    return sandbox;
  }

  parseInput(input) {
    let obj = input;
    if (typeof input === 'string') {
      try { obj = JSON.parse(input); } catch { return { language: 'python', code: input }; }
    }
    if (!obj || typeof obj !== 'object') { throw new Error('Input must be an object or JSON string'); }
    const code = obj.code || obj.script || obj.source;
    if (!code || typeof code !== 'string') { throw new Error('Field "code" is required'); }
    let language = (obj.language || obj.lang || 'python').toLowerCase();
    if (language === 'js' || language === 'node') language = 'javascript';
    if (language === 'sh' || language === 'shell') language = 'bash';
    if (!['python', 'javascript', 'bash'].includes(language)) language = 'python';
    return { language, code };
  }

  async _call(input) {
    let parsed;
    try { parsed = this.parseInput(input); } catch (err) { return `Error: ${err.message}`; }
    const { language, code } = parsed;

    let sandbox;
    try { sandbox = await this.getSandbox(); } catch (err) {
      console.error('[Tensorlake] Sandbox error:', err.message);
      return `Error: failed to create sandbox — ${err.message}`;
    }

    const workDir = '/home/tl-user';
    let filePath, command, cmdArgs;

    switch (language) {
      case 'python':
        filePath = `${workDir}/_exec_${Date.now()}.py`;
        await sandbox.writeFile(filePath, Buffer.from(code, 'utf-8'));
        command = 'python3'; cmdArgs = [filePath]; break;
      case 'javascript':
        filePath = `${workDir}/_exec_${Date.now()}.js`;
        await sandbox.writeFile(filePath, Buffer.from(code, 'utf-8'));
        command = 'node'; cmdArgs = [filePath]; break;
      case 'bash':
        filePath = `${workDir}/_exec_${Date.now()}.sh`;
        await sandbox.writeFile(filePath, Buffer.from(code, 'utf-8'));
        command = 'bash'; cmdArgs = [filePath]; break;
      default:
        return `Error: Unsupported language "${language}".`;
    }

    try {
      const result = await sandbox.run(command, {
        args: cmdArgs, workingDir: workDir,
        env: { PYTHONUNBUFFERED: '1', NODE_ENV: 'development' },
        timeout: 60,
      });

      _sandboxLastUsed = Date.now();

      const stdout = result.stdout || '';
      const stderr = result.stderr || '';
      const exitCode = result.exitCode ?? 0;
      let output = '';
      if (stdout) output += stdout.length > 8000 ? stdout.substring(0, 8000) + '\n... [truncated]' : stdout;
      if (stderr) output += (output ? '\n' : '') + 'STDERR:\n' + (stderr.length > 4000 ? stderr.substring(0, 4000) + '\n... [truncated]' : stderr);
      if (exitCode !== 0) output += (output ? '\n' : '') + `Exit code: ${exitCode}`;

      try {
        const dirListing = await sandbox.listDirectory(workDir);
        const entries = dirListing.entries || dirListing.files || dirListing;
        if (Array.isArray(entries)) {
          const newFiles = entries.filter((e) => {
            const name = e.name || e.filename || '';
            return !name.startsWith('_exec_') && ['png','jpg','jpeg','csv','json','txt','html','svg'].includes(name.split('.').pop()?.toLowerCase() || '');
          });
          if (newFiles.length > 0) {
            output += (output ? '\n\n' : '') + 'Generated files:\n';
            for (const f of newFiles) output += `  - ${f.name || f.filename} (${f.size || 0} bytes)\n`;
          }
        }
      } catch {}

      return output || '(no output)';
    } catch (err) {
      console.error('[Tensorlake] Run error:', err.message);
      return `Error executing code: ${err.message}`;
    }
  }
}

module.exports = TensorlakeCodeInterpreter;
module.exports._sandboxCache = { get: () => _sandbox ? { sandbox: _sandbox, sandboxId: _sandboxId } : null };
module.exports.sandboxCache = module.exports._sandboxCache;
