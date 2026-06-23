/**
 * Tensorlake Code Interpreter — stateful sandbox execution for LibreChat.
 * ─────────────────────────────────────────────────────────────────────────────
 * Replaces LibreChat's built-in code interpreter with a persistent Tensorlake
 * MicroVM sandbox per conversation. Supports Python, JavaScript, and Bash.
 *
 * Requires TENSORLAKE_API_KEY environment variable.
 *
 * Schema notes:
 * - `language` is OPTIONAL (default: python). LLMs often omit it when the
 *   request context makes the language obvious — marking it required causes
 *   "Received tool input did not match expected schema" errors.
 */
const { Tool } = require('@librechat/agents/langchain/tools');

const tensorlakeSchema = {
  type: 'object',
  properties: {
    language: {
      type: 'string',
      enum: ['python', 'javascript', 'bash'],
      description:
        'The programming language to execute. Defaults to "python" if omitted.',
    },
    code: {
      type: 'string',
      description:
        'The code to execute in the sandbox. Files persist across calls within the same conversation.',
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
      'Execute code in a persistent sandbox. Supports Python, JavaScript, and Bash. ' +
      'Files written in one call persist for subsequent calls. ' +
      'Use for: data analysis, file processing, running scripts, installing packages, ' +
      'generating charts, testing code, automating tasks.';
    this.schema = tensorlakeSchema;
    this.envVar = 'TENSORLAKE_API_KEY';

    // Use process.env directly — more reliable than getEnvironmentVariable
    this.apiKey = fields[this.envVar] || process.env[this.envVar] || fields.TENSORLAKE_API_KEY;

    if (!this.apiKey) {
      console.warn('[TensorlakeCodeInterpreter] No API key found in fields or env');
    }

    // Cache sandboxes per conversation (conversationId -> { sandbox, createdAt })
    this.sandboxes = new Map();

    // Bind _call so LangChain's internal validation calls the right `this`
    this._call = this._call.bind(this);
  }

  getApiKey() {
    if (this.apiKey) return this.apiKey;
    const key = process.env.TENSORLAKE_API_KEY;
    if (key) {
      this.apiKey = key;
      return key;
    }
    throw new Error('TENSORLAKE_API_KEY not found in environment or plugin auth');
  }

  /**
   * Get or create a sandbox for the current conversation.
   * Caches per conversationId so files persist across calls.
   */
  async getSandbox(conversationId) {
    if (!conversationId) {
      conversationId = 'default';
    }

    // Reuse cached sandbox if still alive
    if (this.sandboxes.has(conversationId)) {
      const cached = this.sandboxes.get(conversationId);
      try {
        await cached.status();
        return cached;
      } catch (err) {
        console.warn(`[Tensorlake] Cached sandbox dead, recreating: ${err.message}`);
        this.sandboxes.delete(conversationId);
      }
    }

    // Create new sandbox — use require() instead of dynamic import() for CJS compat
    const apiKey = this.getApiKey();
    const { Sandbox } = require('tensorlake');
    const sandbox = await Sandbox.create({
      apiKey,
      name: `lc-${conversationId.slice(0, 12)}`,
      memoryMb: 1024,
      diskMb: 10000,
      vcpus: 1.0,
    });

    this.sandboxes.set(conversationId, sandbox);
    console.log(`[Tensorlake] Created sandbox for conversation ${conversationId}`);
    return sandbox;
  }

  /**
   * Normalize input — accepts string, object, or partial inputs.
   */
  parseInput(input) {
    let obj = input;
    if (typeof input === 'string') {
      try {
        obj = JSON.parse(input);
      } catch {
        // If not JSON, treat as raw python code
        return { language: 'python', code: input };
      }
    }
    if (!obj || typeof obj !== 'object') {
      throw new Error('Input must be an object or JSON string');
    }

    // Accept either `code` or `script` (LLMs sometimes use one or the other)
    const code = obj.code || obj.script || obj.source;
    if (!code || typeof code !== 'string') {
      throw new Error('Field "code" is required');
    }

    // Normalize language — default to python
    let language = (obj.language || obj.lang || 'python').toLowerCase();
    if (language === 'js' || language === 'node') language = 'javascript';
    if (language === 'sh' || language === 'shell') language = 'bash';
    if (!['python', 'javascript', 'bash'].includes(language)) {
      language = 'python';
    }

    return { language, code };
  }

  async _call(input) {
    let parsed;
    try {
      parsed = this.parseInput(input);
    } catch (err) {
      return `Error: ${err.message}`;
    }
    const { language, code } = parsed;

    const conversationId =
      this.metadata?.conversationId ||
      this.metadata?.sessionId ||
      this.metadata?.conversation_id ||
      'default';

    let sandbox;
    try {
      sandbox = await this.getSandbox(conversationId);
    } catch (err) {
      console.error('[TensorlakeCodeInterpreter] Sandbox create error:', err.message);
      return `Error: failed to create sandbox — ${err.message}`;
    }

    const workDir = '/home/tl-user';

    let filePath, command, cmdArgs;

    switch (language) {
      case 'python':
        filePath = `${workDir}/_exec_${Date.now()}.py`;
        await sandbox.writeFile(filePath, Buffer.from(code, 'utf-8'));
        command = 'python3';
        cmdArgs = [filePath];
        break;
      case 'javascript':
        filePath = `${workDir}/_exec_${Date.now()}.js`;
        await sandbox.writeFile(filePath, Buffer.from(code, 'utf-8'));
        command = 'node';
        cmdArgs = [filePath];
        break;
      case 'bash':
        filePath = `${workDir}/_exec_${Date.now()}.sh`;
        await sandbox.writeFile(filePath, Buffer.from(code, 'utf-8'));
        command = 'bash';
        cmdArgs = [filePath];
        break;
      default:
        return `Error: Unsupported language "${language}". Use: python, javascript, or bash`;
    }

    try {
      const result = await sandbox.run(command, {
        args: cmdArgs,
        workingDir: workDir,
        env: { PYTHONUNBUFFERED: '1', NODE_ENV: 'development' },
        timeout: 60,
      });

      const stdout = result.stdout || '';
      const stderr = result.stderr || '';
      const exitCode = result.exitCode ?? 0;

      let output = '';
      if (stdout) {
        output += stdout.length > 8000
          ? stdout.substring(0, 8000) + '\n... [truncated]'
          : stdout;
      }
      if (stderr) {
        output += (output ? '\n' : '') + 'STDERR:\n' + (stderr.length > 4000
          ? stderr.substring(0, 4000) + '\n... [truncated]'
          : stderr);
      }
      if (exitCode !== 0) {
        output += (output ? '\n' : '') + `Exit code: ${exitCode}`;
      }

      // List generated files (skip our _exec_* temp files)
      try {
        const dirListing = await sandbox.listDirectory(workDir);
        const entries = dirListing.entries || dirListing.files || dirListing;
        if (Array.isArray(entries)) {
          const newFiles = entries.filter((e) => {
            const name = e.name || e.filename || '';
            return !name.startsWith('_exec_') &&
              ['png', 'jpg', 'jpeg', 'csv', 'json', 'txt', 'html', 'svg'].includes(
                name.split('.').pop()?.toLowerCase() || '',
              );
          });
          if (newFiles.length > 0) {
            output += (output ? '\n\n' : '') + 'Generated files:\n';
            for (const f of newFiles) {
              output += `  - ${f.name || f.filename} (${f.size || 0} bytes)\n`;
            }
          }
        }
      } catch {
        // ignore directory listing errors
      }

      return output || '(no output)';
    } catch (err) {
      console.error('[TensorlakeCodeInterpreter] Run error:', err.message);
      return `Error executing code: ${err.message}`;
    }
  }
}

module.exports = TensorlakeCodeInterpreter;
