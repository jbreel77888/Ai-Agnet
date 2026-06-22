/**
 * GitHub Integration — repos, issues, PRs
 */
import type { ToolResult, ToolContext } from '../../types';

export class GitHubIntegration {
  private token: string;

  constructor(token?: string) {
    this.token = token || process.env.GITHUB_TOKEN || '';
  }

  async listRepos(username?: string): Promise<ToolResult> {
    try {
      const url = username ? `https://api.github.com/users/${username}/repos` : 'https://api.github.com/user/repos';
      const res = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(10000) });
      const data = await res.json() as any[];
      return { success: true, data: { repos: data.map(r => ({ name: r.name, full_name: r.full_name, url: r.html_url, stars: r.stargazers_count, description: r.description })), count: data.length } };
    } catch (err: any) { return { success: false, error: { code: 'GITHUB_ERROR', message: err.message } }; }
  }

  async listIssues(owner: string, repo: string): Promise<ToolResult> {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=20`, { headers: this.headers(), signal: AbortSignal.timeout(10000) });
      const data = await res.json() as any[];
      return { success: true, data: { issues: data.map(i => ({ number: i.number, title: i.title, state: i.state, url: i.html_url, body: i.body?.substring(0, 200) })), count: data.length } };
    } catch (err: any) { return { success: false, error: { code: 'GITHUB_ERROR', message: err.message } }; }
  }

  async createIssue(owner: string, repo: string, title: string, body: string): Promise<ToolResult> {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ title, body }), signal: AbortSignal.timeout(10000) });
      const data = await res.json();
      return { success: res.ok, data: { number: data.number, title: data.title, url: data.html_url }, error: res.ok ? undefined : { code: 'GITHUB_ERROR', message: data.message } };
    } catch (err: any) { return { success: false, error: { code: 'GITHUB_ERROR', message: err.message } }; }
  }

  async getFile(owner: string, repo: string, path: string, branch?: string): Promise<ToolResult> {
    try {
      const ref = branch ? `?ref=${branch}` : '';
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}${ref}`, { headers: this.headers(), signal: AbortSignal.timeout(10000) });
      const data = await res.json();
      if (data.content) {
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        return { success: true, data: { path: data.path, content, size: data.size } };
      }
      return { success: false, error: { code: 'NOT_FOUND', message: 'File not found' } };
    } catch (err: any) { return { success: false, error: { code: 'GITHUB_ERROR', message: err.message } }; }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Accept': 'application/vnd.github.v3+json' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }
}
