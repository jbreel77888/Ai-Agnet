/**
 * Notion Integration — search pages, get page content
 */
export class NotionIntegration {
  private token: string;

  constructor(token?: string) {
    this.token = token || process.env.NOTION_API_KEY || '';
  }

  async search(query: string): Promise<any> {
    const res = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}`, 'Notion-Version': '2022-06-28' },
      body: JSON.stringify({ query, page_size: 10 }),
      signal: AbortSignal.timeout(10000),
    });
    return res.json();
  }

  async getPage(pageId: string): Promise<any> {
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      headers: { 'Authorization': `Bearer ${this.token}`, 'Notion-Version': '2022-06-28' },
      signal: AbortSignal.timeout(10000),
    });
    return res.json();
  }

  async getBlockChildren(blockId: string): Promise<any> {
    const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}/children`, {
      headers: { 'Authorization': `Bearer ${this.token}`, 'Notion-Version': '2022-06-28' },
      signal: AbortSignal.timeout(10000),
    });
    return res.json();
  }
}
