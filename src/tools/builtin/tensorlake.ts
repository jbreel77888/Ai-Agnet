/**
 * Tensorlake Sandbox Tool — execute code in isolated MicroVM sandboxes
 *
 * Uses the official Tensorlake TypeScript SDK to create sandboxes,
 * run code, manage files, and terminate when done.
 *
 * Requires TENSORLAKE_API_KEY environment variable.
 */
import type { ITool } from '../registry';
import type { ToolResult, ToolContext } from '../../types';

export class TensorlakeSandboxTool implements ITool {
  readonly name = 'code_execution';
  readonly description = 'Execute code in an isolated sandbox. Supports Python, JavaScript, shell commands, and file operations. Use this to run LLM-generated code safely.';
  readonly category = 'builtin';
  readonly schema = {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        enum: ['python', 'javascript', 'bash', 'shell'],
        description: 'Programming language to execute',
        default: 'python',
      },
      code: {
        type: 'string',
        description: 'The code to execute in the sandbox',
      },
      files: {
        type: 'object',
        description: 'Optional files to write to the sandbox before execution. Key is the file path, value is the file content.',
        additionalProperties: { type: 'string' },
      },
      timeout: {
        type: 'integer',
        minimum: 5,
        maximum: 300,
        default: 60,
        description: 'Maximum execution time in seconds',
      },
    },
    required: ['language', 'code'],
    additionalProperties: false,
  };

  validate(args: any) {
    if (!args?.code) return { valid: false, errors: ['code is required'] };
    if (!args?.language) return { valid: false, errors: ['language is required'] };
    return { valid: true };
  }

  async execute(args: {
    language: string;
    code: string;
    files?: Record<string, string>;
    timeout?: number;
  }, ctx: ToolContext): Promise<ToolResult> {
    const apiKey = process.env.TENSORLAKE_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error: { code: 'NO_API_KEY', message: 'TENSORLAKE_API_KEY not set. Add it in Settings → Integrations or env vars.' },
      };
    }

    let sandbox: any = null;
    try {
      // Dynamic import to avoid loading the SDK when not needed
      const { Sandbox } = await import('tensorlake');

      // Create sandbox with appropriate resources
      sandbox = await Sandbox.create({
        cpus: 1.0,
        memoryMb: 1024,
        diskMb: 10000,
        timeoutSecs: args.timeout || 60,
      });

      console.log(`[tensorlake] Sandbox created: ${sandbox.sandboxId}`);

      // Write optional files
      if (args.files) {
        for (const [path, content] of Object.entries(args.files)) {
          await sandbox.writeFile(`/workspace/${path}`, Buffer.from(content));
        }
      }

      // Determine the command based on language
      let command: string;
      let cmdArgs: string[];
      const code = args.code;

      switch (args.language) {
        case 'python':
          // Write code to a temp file and execute
          await sandbox.writeFile('/workspace/_exec.py', Buffer.from(code));
          command = 'python';
          cmdArgs = ['/workspace/_exec.py'];
          break;
        case 'javascript':
        case 'js':
          await sandbox.writeFile('/workspace/_exec.js', Buffer.from(code));
          command = 'node';
          cmdArgs = ['/workspace/_exec.js'];
          break;
        case 'bash':
        case 'shell':
        case 'sh':
          await sandbox.writeFile('/workspace/_exec.sh', Buffer.from(code));
          command = 'bash';
          cmdArgs = ['/workspace/_exec.sh'];
          break;
        default:
          return {
            success: false,
            error: { code: 'UNSUPPORTED_LANGUAGE', message: `Language "${args.language}" not supported. Use: python, javascript, or bash` },
          };
      }

      // Execute the code
      const result = await sandbox.run(command, { args: cmdArgs });

      const output = {
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: result.exitCode ?? 0,
        success: (result.exitCode ?? 0) === 0,
        sandboxId: sandbox.sandboxId,
      };

      // Truncate output to reasonable size
      if (output.stdout.length > 5000) output.stdout = output.stdout.substring(0, 5000) + '\n... (truncated)';
      if (output.stderr.length > 5000) output.stderr = output.stderr.substring(0, 5000) + '\n... (truncated)';

      return {
        success: output.success,
        data: output,
        error: output.success ? undefined : {
          code: 'EXEC_ERROR',
          message: `Process exited with code ${output.exitCode}`,
          details: output.stderr,
        },
      };
    } catch (err: any) {
      console.error('[tensorlake] Error:', err.message);
      return {
        success: false,
        error: { code: 'SANDBOX_ERROR', message: err.message },
      };
    } finally {
      // Always terminate the sandbox
      if (sandbox) {
        try {
          await sandbox.terminate();
          console.log(`[tensorlake] Sandbox terminated: ${sandbox.sandboxId}`);
        } catch {
          // Ignore termination errors
        }
      }
    }
  }
}

/**
 * Register the Tensorlake sandbox tool if API key is available
 */
export function registerTensorlakeTool(): void {
  if (!process.env.TENSORLAKE_API_KEY) {
    console.log('[tools] Tensorlake sandbox tool skipped (no TENSORLAKE_API_KEY)');
    return;
  }
  const { getToolRegistry } = require('../registry');
  const registry = getToolRegistry();
  registry.register(new TensorlakeSandboxTool());
  console.log('[tools] Registered Tensorlake sandbox tool (code_execution)');
}
