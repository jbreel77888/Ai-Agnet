/**
 * File Manager Tool — read/write/list/edit/delete files inside the persistent sandbox.
 * ─────────────────────────────────────────────────────────────────────────────
 * Each chat session has one stateful Tensorlake sandbox. This tool exposes
 * filesystem operations on that sandbox. Files written here persist across
 * tool calls within the same session.
 *
 * Actions:
 *   - read      → read file content (text or base64 for binary)
 *   - write     → write/overwrite a file
 *   - list      → list directory contents
 *   - edit      → search/replace in a file (patch-style)
 *   - delete    → delete a file
 *   - mkdir     → create a directory
 *   - exists    → check if file/dir exists
 *
 * All paths are relative to /home/user (sandbox home) unless absolute.
 */
import type { ITool } from '../registry';
import type { ToolResult, ToolContext } from '../../types';
import { getSandboxManager } from '../../sandbox/manager';

const WORK_DIR = '/home/user';

function resolvePath(p: string): string {
  if (!p) return WORK_DIR;
  if (p.startsWith('/')) return p;
  return `${WORK_DIR}/${p}`;
}

export class FileManagerTool implements ITool {
  readonly name = 'file_manager';
  readonly description = 'Read, write, list, edit, delete files inside the persistent sandbox for this session. Files persist across all tool calls in the same session. Use this to manage project files, save artifacts, edit existing files.';
  readonly category = 'builtin';
  readonly schema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'write', 'list', 'edit', 'delete', 'mkdir', 'exists'],
        description: 'File operation to perform',
      },
      path: {
        type: 'string',
        description: 'File or directory path (relative to /home/user, or absolute)',
      },
      content: {
        type: 'string',
        description: 'File content (for write action)',
      },
      edits: {
        type: 'array',
        description: 'For edit action: array of {oldText, newText} patches applied in order',
        items: {
          type: 'object',
          properties: {
            oldText: { type: 'string' },
            newText: { type: 'string' },
          },
          required: ['oldText', 'newText'],
        },
      },
    },
    required: ['action', 'path'],
    additionalProperties: false,
  };

  validate(args: any) {
    if (!args?.action) return { valid: false, errors: ['action is required'] };
    if (!args?.path) return { valid: false, errors: ['path is required'] };
    const validActions = ['read', 'write', 'list', 'edit', 'delete', 'mkdir', 'exists'];
    if (!validActions.includes(args.action)) {
      return { valid: false, errors: [`Invalid action: ${args.action}. Use one of: ${validActions.join(', ')}`] };
    }
    if (args.action === 'write' && !args.content) {
      return { valid: false, errors: ['content is required for write action'] };
    }
    if (args.action === 'edit' && (!args.edits || !Array.isArray(args.edits) || args.edits.length === 0)) {
      return { valid: false, errors: ['edits array is required for edit action'] };
    }
    return { valid: true };
  }

  async execute(args: any, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.sessionId) {
      return { success: false, error: { code: 'NO_SESSION', message: 'file_manager requires a session context' } };
    }

    const sandboxManager = getSandboxManager();
    const handle = await sandboxManager.getSessionSandbox(ctx.sessionId);
    if (!handle) {
      return { success: false, error: { code: 'SANDBOX_UNAVAILABLE', message: 'Failed to get sandbox for this session' } };
    }

    const { sandbox, sandboxId } = handle;
    const fullPath = resolvePath(args.path);

    try {
      switch (args.action) {
        case 'read': {
          const data = await sandbox.readFile(fullPath);
          const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
          // Try to decode as UTF-8; if it fails, return base64
          try {
            const text = buffer.toString('utf-8');
            if (text.length > 20000) {
              return {
                success: true,
                data: {
                  content: text.substring(0, 20000) + `\n... [truncated, full length ${text.length}]`,
                  truncated: true,
                  size: buffer.length,
                  path: fullPath,
                  encoding: 'utf-8',
                },
              };
            }
            return {
              success: true,
              data: { content: text, size: buffer.length, path: fullPath, encoding: 'utf-8' },
            };
          } catch {
            return {
              success: true,
              data: {
                content: buffer.toString('base64'),
                size: buffer.length,
                path: fullPath,
                encoding: 'base64',
              },
            };
          }
        }

        case 'write': {
          const content = Buffer.from(args.content, 'utf-8');
          await sandbox.writeFile(fullPath, content);
          return {
            success: true,
            data: { path: fullPath, bytesWritten: content.length, action: 'write' },
          };
        }

        case 'list': {
          const result = await sandbox.listDirectory(fullPath);
          const entries = (result as any).entries || (result as any).files || result;
          let listing: any[];
          if (Array.isArray(entries)) {
            listing = entries.map((e: any) => ({
              name: e.name || e.filename,
              type: e.type || (e.isDirectory ? 'directory' : 'file'),
              size: e.size || 0,
            }));
          } else {
            listing = [];
          }
          return {
            success: true,
            data: { path: fullPath, entries: listing, count: listing.length },
          };
        }

        case 'edit': {
          // Read existing content
          const data = await sandbox.readFile(fullPath);
          const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
          let content = buffer.toString('utf-8');
          const appliedEdits: Array<{ oldTextLength: number; newTextLength: number }> = [];
          const failedEdits: Array<{ index: number; reason: string }> = [];

          for (let i = 0; i < args.edits.length; i++) {
            const edit = args.edits[i];
            if (!content.includes(edit.oldText)) {
              failedEdits.push({ index: i, reason: 'oldText not found in file' });
              continue;
            }
            content = content.replace(edit.oldText, edit.newText);
            appliedEdits.push({ oldTextLength: edit.oldText.length, newTextLength: edit.newText.length });
          }

          // Write back
          await sandbox.writeFile(fullPath, Buffer.from(content, 'utf-8'));
          return {
            success: true,
            data: {
              path: fullPath,
              appliedEdits: appliedEdits.length,
              failedEdits,
              newSize: content.length,
            },
          };
        }

        case 'delete': {
          await sandbox.deleteFile(fullPath);
          return {
            success: true,
            data: { path: fullPath, action: 'delete' },
          };
        }

        case 'mkdir': {
          // mkdir via bash since SDK doesn't expose it directly
          await sandbox.run('mkdir', { args: ['-p', fullPath] });
          return {
            success: true,
            data: { path: fullPath, action: 'mkdir' },
          };
        }

        case 'exists': {
          // Use ls to check if path exists
          try {
            const result = await sandbox.run('test', { args: ['-e', fullPath] });
            const exists = (result as any).exitCode === 0;
            return {
              success: true,
              data: { path: fullPath, exists },
            };
          } catch {
            return {
              success: true,
              data: { path: fullPath, exists: false },
            };
          }
        }

        default:
          return { success: false, error: { code: 'UNKNOWN_ACTION', message: `Unknown action: ${args.action}` } };
      }
    } catch (err: any) {
      // Common error: file not found, etc.
      const isNotFound = err.message?.includes('not found') || err.message?.includes('does not exist') || err.message?.includes('No such file');
      return {
        success: false,
        error: {
          code: isNotFound ? 'NOT_FOUND' : 'FILE_ERROR',
          message: err.message,
          details: { action: args.action, path: fullPath, sandboxId },
        },
      };
    }
  }
}
