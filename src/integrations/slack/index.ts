/**
 * Slack Integration — send messages, list channels
 */
export class SlackIntegration {
  private token: string;

  constructor(token?: string) {
    this.token = token || process.env.SLACK_BOT_TOKEN || '';
  }

  async sendMessage(channel: string, text: string): Promise<any> {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
      body: JSON.stringify({ channel, text }),
      signal: AbortSignal.timeout(10000),
    });
    return res.json();
  }

  async listChannels(): Promise<any> {
    const res = await fetch('https://slack.com/api/conversations.list?limit=50', {
      headers: { 'Authorization': `Bearer ${this.token}` },
      signal: AbortSignal.timeout(10000),
    });
    return res.json();
  }

  async getHistory(channel: string, limit = 10): Promise<any> {
    const res = await fetch(`https://slack.com/api/conversations.history?channel=${channel}&limit=${limit}`, {
      headers: { 'Authorization': `Bearer ${this.token}` },
      signal: AbortSignal.timeout(10000),
    });
    return res.json();
  }
}
