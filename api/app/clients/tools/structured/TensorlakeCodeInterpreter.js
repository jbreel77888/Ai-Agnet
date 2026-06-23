/**
 * Tensorlake Code Interpreter — stateful sandbox execution for LibreChat.
 * ─────────────────────────────────────────────────────────────────────────────
 * Replaces LibreChat's built-in code interpreter with a persistent Tensorlake
 * MicroVM sandbox per session. Supports Python, JavaScript, and Bash.
 *
 * Requires TENSORLAKE_API_KEY environment variable.
 */
const { Tool } = require('@librechat/agents/langchain/tools');

const tensorlakeSchema = {
  type: 'object',
  properties: {
    language: {
      type: 'string',
      enum: ['python', 'javascript', 'bash'],
      description: 'The programming language to execute',
      default: 'python',
    },
    code: {
      type: 'string',
      description: 'The code to execute in the sandbox. Files persist across calls within the same conversation.',
    },
  },
  required: ['language', 'code'],
};

class TensorlakeCodeInterpreter extends Tool {
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
    // Also check fields (from plugin auth DB)
    this.apiKey = fields[this.envVar] || process.env[this.envVar] || fields.TENSORLAKE_API_KEY;

    // Don't throw in constructor — lazy-load in _call
    if (!this.apiKey) {
      console.warn('[TensorlakeCodeInterpreter] No API key found in fields or env, will try at runtime');
    }

    // Cache sandboxes per conversation
    this.sandboxes = new Map();
  }

  /**
   * Get API key — try multiple sources
   */
  getApiKey() {
    if (this.apiKey) return this.apiKey;
    // Try process.env directly
    const key = process.env.TENSORLAKE_API_KEY;
    if (key) {
      this.apiKey = key;
      return key;
    }
    throw new Error('TENSORLAKE_API_KEY not found in environment or plugin auth');
  }

  /**
   * Get or create a sandbox for the current conversation.
   */
  async getSandbox(conversationId) {
    if (!conversationId) {
      conversationId = 'default';
    }

    // Check cache
    if (this.sandboxes.has(conversationId)) {
      const cached = this.sandboxes.get(conversationId);
      try {
        await cached.status();
        return cached;
      } catch {
        this.sandboxes.delete(conversationId);
      }
    }

    // Create new sandbox
    const apiKey = this.getApiKey();
    const { Sandbox } = await import('tensorlake');
    const sandbox = await Sandbox.create({
      apiKey,
      name: `lc-${conversationId.slice(0, 12)}`,
      memoryMb: 1024,
      diskMb: 10000,
      vcpus: 1.0,
    });

    this.sandboxes.set(conversationId, sandbox);
    console.log(`[Tensorlake] Created sandbox ${sandbox.sandboxId} for conversation ${conversationId}`);
    return sandbox;
  }

  async _call(input) {
    const { language, code } = typeof input === 'string' ? JSON.parse(input) : input;

    if (!code) {
      return 'Error: code is required';
    }

    const conversationId = this.metadata?.conversationId || this.metadata?.sessionId || 'default';

    try {
      const sandbox = await this.getSandbox(conversationId);
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

      const result = await sandbox.run(command, {
        args: cmdArgs,
        workDir,
        envs: { PYTHONUNBUFFERED: '1', NODE_ENV: 'development' },
        timeoutMs: 60000,
      });

      const stdout = (result).stdout || '';
      const stderr = (result).stderr || '';
      const exitCode = (result).exitCode ?? 0;

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

      // Check for generated files
      try {
        const dirListing = await sandbox.listDirectory(workDir);
        const entries = (dirListing).entries || (dirListing).files || dirListing;
        if (Array.isArray(entries)) {
          const newFiles = entries.filter(
            (e) => {
              const name = e.name || e.filename || '';
              return !name.startsWith('_exec_') &&
                ['png', 'jpg', 'csv', 'json', 'txt', 'html', 'svg'].includes(
                  name.split('.').pop()?.toLowerCase() || ''
                );
            }
          );
          if (newFiles.length > 0) {
            output += (output ? '\n\n' : '') + 'Generated files:\n';
            for (const f of newFiles) {
              output += `  - ${f.name || f.filename} (${f.size || 0} bytes)\n`;
            }
          }
        }
      } catch {}

      return output || '(no output)';
    } catch (err) {
      console.error('[TensorlakeCodeInterpreter] Error:', err.message);
      return `Error: ${err.message}`;
    }
  }
}

module.exports = TensorlakeCodeInterpreter;
