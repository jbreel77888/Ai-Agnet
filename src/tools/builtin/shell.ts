/**
 * Shell Tool — execute bash commands inside the persistent sandbox.
 * ─────────────────────────────────────────────────────────────────────────────
 * Like code_execution with language=bash, but with a more shell-friendly
 * interface: command string + optional stdin + working directory.
 * Working directory persists across calls (cd'd into /home/user by default
 * but can be changed via the workingDir arg).
 *
 * Use cases:
 *   - Install packages: `pip install pandas matplotlib`
 *   - Run tests: `pytest tests/`
 *   - Git operations: `git status`
 *   - File inspection: `cat file.txt | head -100`
 *   - Process management: `ps aux`
 */
import type { ITool } from '../registry';
import type { ToolResult, ToolContext } from '../../types';
import { getSandboxManager } from '../../sandbox/manager';

const DEFAULT_WORK_DIR = '/home/user';

export class ShellTool implements ITool {
  readonly name = 'shell';
  readonly description = 'Execute bash shell commands in the persistent sandbox for this session. Working directory and installed packages persist across calls. Use for package installation (pip/npm), running tests, git operations, file inspection.';
  readonly category = 'builtin';
  readonly schema = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Shell command to execute (e.g., "pip install pandas", "ls -la", "git status")',
      },
      workingDir: {
        type: 'string',
        description: 'Working directory (default: /home/user)',
        default: '/home/user',
      },
      timeout: {
        type: 'integer',
        minimum: 5,
        maximum: 300,
        default: 60,
        description: 'Maximum execution time in seconds',
      },
    },
    required: ['command'],
    additionalProperties: false,
  };

  validate(args: any) {
    if (!args?.command) return { valid: false, errors: ['command is required'] };
    if (typeof args.command !== 'string') return { valid: false, errors: ['command must be a string'] };
    if (args.command.length > 10000) return { valid: false, errors: ['command too long (max 10000 chars)'] };
    // Block obviously dangerous commands (defense in depth — sandbox is isolated anyway)
    const dangerous = /\b(rm\s+-rf\s+\/|mkfs|dd\s+if=.*of=\/dev|:\(\)\s*\{\s*:\|\s*:&\s*\};)\b/;
    if (dangerous.test(args.command)) {
      return { valid: false, errors: ['Command blocked: contains dangerous pattern (rm -rf /, mkfs, fork bomb)'] };
    }
    return { valid: true };
  }

  async execute(args: {
    command: string;
    workingDir?: string;
    timeout?: number;
  }, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.sessionId) {
      return { success: false, error: { code: 'NO_SESSION', message: 'shell requires a session context' } };
    }

    const sandboxManager = getSandboxManager();
    const handle = await sandboxManager.getSessionSandbox(ctx.sessionId);
    if (!handle) {
      return { success: false, error: { code: 'SANDBOX_UNAVAILABLE', message: 'Failed to get sandbox' } };
    }

    const { sandbox, sandboxId } = handle;
    const workDir = args.workingDir || DEFAULT_WORK_DIR;

    try {
      // Run via bash -c to support shell features (pipes, redirects, etc.)
      const result = await sandbox.run('bash', {
        args: ['-c', args.command],
        workDir,
        envs: {
          PYTHONUNBUFFERED: '1',
          TERM: 'dumb',
          HOME: '/home/user',
          PATH: '/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin',
        },
        timeoutMs: (args.timeout || 60) * 1000,
      });

      const stdout = (result as any).stdout || '';
      const stderr = (result as any).stderr || '';
      const exitCode = (result as any).exitCode ?? 0;
      const success = exitCode === 0;

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
          workingDir: workDir,
          sandboxId,
        },
        error: success ? undefined : {
          code: 'EXEC_ERROR',
          message: `Command exited with code ${exitCode}`,
          details: truncStderr,
        },
      };
    } catch (err: any) {
      return { success: false, error: { code: 'SHELL_ERROR', message: err.message } };
    }
  }
}
