/**
 * Tensorlake Sandbox Tool — STATEFUL code execution in isolated MicroVM sandboxes.
 * ─────────────────────────────────────────────────────────────────────────────
 * Each chat session gets ONE persistent Tensorlake sandbox. Files written in
 * step 1 are still there in step 2. Packages installed via pip/npm persist
 * across tool calls within the same session.
 *
 * Uses the SandboxManager to get/create the sandbox per session.
 * The sandboxId is persisted in `agent_sessions.metadata.sandboxId`.
 *
 * Requires TENSORLAKE_API_KEY environment variable.
 */
import type { ITool } from '../registry';
import type { ToolResult, ToolContext } from '../../types';
import { getSandboxManager } from '../../sandbox/manager';

export class TensorlakeSandboxTool implements ITool {
  readonly name = 'code_execution';
  readonly description = 'Execute code in an isolated, STATEFUL sandbox (persists across calls in the same session). Supports Python, JavaScript/Node, and Bash. Files written in one call are available in the next. Packages installed via pip/npm persist. Use this to run LLM-generated code safely.';
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
    if (!['python', 'javascript', 'bash', 'shell'].includes(args.language)) {
      return { valid: false, errors: [`Unsupported language: ${args.language}. Use: python, javascript, or bash`] };
    }
    if (args.code.length > 100000) {
      return { valid: false, errors: ['Code too long (max 100,000 chars)'] };
    }
    return { valid: true };
  }

  async execute(args: {
    language: string;
    code: string;
    timeout?: number;
  }, ctx: ToolContext): Promise<ToolResult> {
    if (!process.env.TENSORLAKE_API_KEY) {
      return {
        success: false,
        error: { code: 'NO_API_KEY', message: 'TENSORLAKE_API_KEY not set. Add it as an environment variable.' },
      };
    }

    if (!ctx.sessionId) {
      return {
        success: false,
        error: { code: 'NO_SESSION', message: 'code_execution requires a session context (sessionId)' },
      };
    }

    const sandboxManager = getSandboxManager();
    const handle = await sandboxManager.getSessionSandbox(ctx.sessionId);
    if (!handle) {
      return {
        success: false,
        error: { code: 'SANDBOX_UNAVAILABLE', message: 'Failed to create or connect to a sandbox' },
      };
    }

    const { sandbox, sandboxId } = handle;

    try {
      // Determine language + write code to a file in /home/tl-user (sandbox home)
      const workDir = '/home/tl-user';
      let filePath: string;
      let command: string;
      let cmdArgs: string[];

      switch (args.language) {
        case 'python':
          filePath = `${workDir}/_exec_${Date.now()}.py`;
          await sandbox.writeFile(filePath, Buffer.from(args.code, 'utf-8'));
          command = 'python3';
          cmdArgs = [filePath];
          break;
        case 'javascript':
          filePath = `${workDir}/_exec_${Date.now()}.js`;
          await sandbox.writeFile(filePath, Buffer.from(args.code, 'utf-8'));
          command = 'node';
          cmdArgs = [filePath];
          break;
        case 'bash':
        case 'shell':
          filePath = `${workDir}/_exec_${Date.now()}.sh`;
          await sandbox.writeFile(filePath, Buffer.from(args.code, 'utf-8'));
          command = 'bash';
          cmdArgs = [filePath];
          break;
        default:
          return {
            success: false,
            error: { code: 'UNSUPPORTED_LANGUAGE', message: `Language "${args.language}" not supported` },
          };
      }

      // Execute the code
      const result = await sandbox.run(command, {
        args: cmdArgs,
        workDir,
        envs: { PYTHONUNBUFFERED: '1', NODE_ENV: 'development' },
        timeoutMs: (args.timeout || 60) * 1000,
      });

      // The result has stdout, stderr, exitCode
      const stdout = (result as any).stdout || '';
      const stderr = (result as any).stderr || '';
      const exitCode = (result as any).exitCode ?? 0;
      const success = exitCode === 0;

      // Truncate very large outputs
      const maxLen = 8000;
      const truncStdout = stdout.length > maxLen
        ? stdout.substring(0, maxLen) + `\n... [truncated, full length ${stdout.length}]`
        : stdout;
      const truncStderr = stderr.length > maxLen
        ? stderr.substring(0, maxLen) + `\n... [truncated, full length ${stderr.length}]`
        : stderr;

      return {
        success,
        data: {
          stdout: truncStdout,
          stderr: truncStderr,
          exitCode,
          sandboxId,
          language: args.language,
          durationMs: (result as any).durationMs,
        },
        error: success ? undefined : {
          code: 'EXEC_ERROR',
          message: `Process exited with code ${exitCode}`,
          details: truncStderr,
        },
      };
    } catch (err: any) {
      console.error(`[tensorlake] Execution error for session ${ctx.sessionId}:`, err.message);
      return {
        success: false,
        error: { code: 'SANDBOX_ERROR', message: err.message, details: err.stack },
      };
    }
    // NOTE: No finally { sandbox.terminate() } — sandbox is stateful, persists per session
  }
}
