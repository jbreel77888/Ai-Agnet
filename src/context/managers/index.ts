/**
 * Context Manager — manages context window, compression, summarization
 *
 * Responsibilities:
 * - Estimate token counts for messages
 * - Compress old messages when approaching context window limit
 * - Summarize conversations
 * - Extract entities from text
 * - Build enriched system prompts
 */
import type { ChatMessage } from '../../types';
import type { ContextManager, BuildSystemPromptOpts, CompressContext, CompressionResult, ExtractedEntity, SummarizeOpts, ContextEnrichment } from './types';
import { getLongTermMemory } from '../../memory/long-term';
import { getProviderManager } from '../../providers/manager';

// Rough token estimation: ~4 characters per token for English, ~2 for CJK
function estimateTokens(text: string): number {
  if (!text) return 0;
  // Simple heuristic
  const charCount = text.length;
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  // Use the larger estimate
  return Math.ceil(Math.max(charCount / 4, wordCount * 1.3));
}

export function createContextManager(): ContextManager {
  const estimateTokensFn = estimateTokens;

  const estimateMessagesTokens = (messages: ChatMessage[]): number => {
    let total = 0;
    for (const msg of messages) {
      // Each message has overhead (~4 tokens for role + formatting)
      total += 4;
      if (typeof msg.content === 'string') {
        total += estimateTokensFn(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text') total += estimateTokensFn(block.text);
          else if (block.type === 'image') total += 1000; // rough estimate for images
          else if (block.type === 'tool_use') total += estimateTokensFn(JSON.stringify(block.input));
          else if (block.type === 'tool_result') total += estimateTokensFn(typeof block.content === 'string' ? block.content : JSON.stringify(block.content));
        }
      }
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          total += estimateTokensFn(JSON.stringify(tc.arguments)) + 10;
        }
      }
    }
    return total;
  };

  const buildSystemPrompt = async (opts: BuildSystemPromptOpts): Promise<string> => {
    const parts: string[] = [];

    // Agent's base system prompt
    if (opts.agentSystemPrompt) {
      parts.push(opts.agentSystemPrompt);
    }

    // Previous context summary (if any)
    if (opts.previousContextSummary) {
      parts.push(`\n## Previous Context Summary\n${opts.previousContextSummary}`);
    }

    // Relevant memories
    if (opts.relevantMemories && opts.relevantMemories.length > 0) {
      parts.push('\n## Relevant Memories');
      for (const mem of opts.relevantMemories) {
        parts.push(`- [importance: ${mem.importance.toFixed(2)}, score: ${mem.score.toFixed(2)}] ${mem.fact}`);
      }
    }

    // Available tools
    if (opts.availableTools && opts.availableTools.length > 0) {
      parts.push('\n## Available Tools');
      for (const tool of opts.availableTools) {
        parts.push(`- **${tool.name}**: ${tool.description}`);
      }
    }

    // Variables
    if (opts.variables && Object.keys(opts.variables).length > 0) {
      parts.push('\n## Session Variables');
      for (const [key, value] of Object.entries(opts.variables)) {
        parts.push(`- ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
      }
    }

    // Current user message (for context)
    if (opts.userMessage) {
      parts.push(`\n## Current User Message\n${opts.userMessage}`);
    }

    return parts.join('\n');
  };

  const compressIfNeeded = async (ctx: CompressContext): Promise<CompressionResult> => {
    const thresholdPercent = ctx.thresholdPercent ?? 80;
    const thresholdTokens = Math.floor(ctx.contextWindow * thresholdPercent / 100);

    const currentTokens = estimateMessagesTokens(ctx.messages);

    if (currentTokens <= thresholdTokens) {
      return {
        compressed: false,
        newMessages: ctx.messages,
        tokensSaved: 0,
        strategy: 'none',
      };
    }

    // Need to compress — take the oldest messages and summarize them
    // Keep the most recent messages intact
    const targetTokens = Math.floor(ctx.contextWindow * 0.5); // compress to 50%
    const tokensToSave = currentTokens - targetTokens;

    // Find the cutoff: oldest messages whose total tokens equals tokensToSave
    let accumulatedTokens = 0;
    let cutoffIndex = 0;
    for (let i = ctx.messages.length - 1; i >= 0; i--) {
      accumulatedTokens += estimateMessagesTokens([ctx.messages[i]]);
      if (accumulatedTokens >= tokensToSave) {
        cutoffIndex = i;
        break;
      }
    }

    const toCompress = ctx.messages.slice(0, cutoffIndex + 1);
    const toKeep = ctx.messages.slice(cutoffIndex + 1);

    if (toCompress.length === 0) {
      return {
        compressed: false,
        newMessages: ctx.messages,
        tokensSaved: 0,
        strategy: 'none',
      };
    }

    // Generate a summary
    let summary: string;
    try {
      summary = await summarize(toCompress, { maxLength: 500, style: 'concise' });
    } catch (err) {
      // Fallback: extractive summarization (just concatenate first sentences)
      summary = extractiveSummary(toCompress);
    }

    // Store the summary in long-term memory
    try {
      const longTermMemory = getLongTermMemory();
      await longTermMemory.storeSummary({
        sessionId: ctx.sessionId,
        summary,
        tokensSaved: tokensToSave,
        coveredMessageIds: [], // Would need message IDs
      });
    } catch (err) {
      console.warn('[context] Failed to store summary:', err);
    }

    // Build the new message list with the summary as the first message
    const summaryMessage: ChatMessage = {
      role: 'system',
      content: `## Conversation Summary (auto-generated)\n${summary}`,
    };

    return {
      compressed: true,
      newMessages: [summaryMessage, ...toKeep],
      summaryCreated: summary,
      tokensSaved: tokensToSave,
      strategy: 'rolling',
    };
  };

  const summarize = async (messages: ChatMessage[], opts: SummarizeOpts = {}): Promise<string> => {
    const maxLength = opts.maxLength ?? 500;
    const style = opts.style ?? 'concise';

    const stylePrompt = {
      concise: 'Be very concise (3-5 sentences).',
      detailed: 'Provide a detailed summary covering all key points.',
      bullet: 'Use bullet points for the main points.',
    }[style];

    const conversationText = messages.map(m => {
      const role = m.role.toUpperCase();
      if (typeof m.content === 'string') return `${role}: ${m.content}`;
      const textParts = (m.content as any[]).filter(b => b.type === 'text').map(b => b.text).join(' ');
      return `${role}: ${textParts}`;
    }).join('\n\n');

    const prompt = `Summarize the following conversation. ${stylePrompt} Maximum ${maxLength} characters.

Conversation:
${conversationText}

Summary:`;

    // Try to use LLM for summarization
    try {
      const providerManager = getProviderManager();
      const models = providerManager.listModels();
      if (models.length === 0) {
        return extractiveSummary(messages);
      }

      // Pick the cheapest model (lowest priority number)
      const model = models.sort((a, b) => a.priority - b.priority)[0];
      const response = await providerManager.chat({
        modelId: model.id,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        maxTokens: Math.ceil(maxLength / 4),
      });

      return response.content.trim();
    } catch (err) {
      console.warn('[context] LLM summarization failed, using extractive:', err);
      return extractiveSummary(messages);
    }
  };

  const extractEntities = async (text: string): Promise<ExtractedEntity[]> => {
    const entities: ExtractedEntity[] = [];

    // Simple pattern-based extraction (no LLM)
    // Email
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    let match;
    while ((match = emailRegex.exec(text)) !== null) {
      entities.push({ type: 'email', value: match[0], confidence: 0.95 });
    }

    // URL
    const urlRegex = /https?:\/\/[^\s]+/g;
    while ((match = urlRegex.exec(text)) !== null) {
      entities.push({ type: 'url', value: match[0], confidence: 0.9 });
    }

    // Date (simple)
    const dateRegex = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/g;
    while ((match = dateRegex.exec(text)) !== null) {
      entities.push({ type: 'date', value: match[0], confidence: 0.85 });
    }

    // Phone
    const phoneRegex = /\+?\d[\d\s-]{8,}\d/g;
    while ((match = phoneRegex.exec(text)) !== null) {
      entities.push({ type: 'phone', value: match[0], confidence: 0.8 });
    }

    // Capitalized words (potential names) — only if 2+ words
    const nameRegex = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
    while ((match = nameRegex.exec(text)) !== null) {
      // Filter out common false positives
      if (!['The', 'This', 'That', 'These', 'Those', 'New Year', 'San Francisco'].includes(match[0])) {
        entities.push({ type: 'person', value: match[0], canonical: match[0], confidence: 0.6 });
      }
    }

    // Mentioned projects/code (in backticks or quotes)
    const codeRegex = /`([^`]+)`/g;
    while ((match = codeRegex.exec(text)) !== null) {
      entities.push({ type: 'code', value: match[1], confidence: 0.85 });
    }

    return entities;
  };

  const truncateToContext = (messages: ChatMessage[], contextWindow: number): ChatMessage[] => {
    const totalTokens = estimateMessagesTokens(messages);
    if (totalTokens <= contextWindow) return messages;

    // Truncate from the beginning, keeping recent messages
    const result: ChatMessage[] = [];
    let accumulated = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msgTokens = estimateMessagesTokens([messages[i]]);
      if (accumulated + msgTokens > contextWindow) break;
      result.unshift(messages[i]);
      accumulated += msgTokens;
    }

    return result;
  };

  return {
    buildSystemPrompt,
    compressIfNeeded,
    extractEntities,
    summarize,
    truncateToContext,
    estimateTokens: estimateTokensFn,
    estimateMessagesTokens,
  };
}

function extractiveSummary(messages: ChatMessage[]): string {
  // Pick the first 1-2 sentences from each user message + the most recent assistant message
  const userMessages = messages.filter(m => m.role === 'user');
  const assistantMessages = messages.filter(m => m.role === 'assistant');

  const parts: string[] = [];

  for (const msg of userMessages.slice(0, 3)) {
    const content = typeof msg.content === 'string' ? msg.content : (msg.content as any[]).filter(b => b.type === 'text').map(b => b.text).join(' ');
    const firstSentence = content.split(/[.!?]/)[0];
    if (firstSentence) parts.push(`User asked: ${firstSentence.trim()}.`);
  }

  const lastAssistant = assistantMessages[assistantMessages.length - 1];
  if (lastAssistant) {
    const content = typeof lastAssistant.content === 'string' ? lastAssistant.content : (lastAssistant.content as any[]).filter(b => b.type === 'text').map(b => b.text).join(' ');
    if (content) {
      parts.push(`Assistant responded: ${content.substring(0, 200)}...`);
    }
  }

  return parts.join(' ') || 'Conversation context summary unavailable.';
}

// Singleton
let contextManagerInstance: ContextManager | null = null;
export function getContextManager(): ContextManager {
  if (!contextManagerInstance) contextManagerInstance = createContextManager();
  return contextManagerInstance;
}

// Singleton getter for long-term memory
let longTermMemoryInstance: any = null;
function getLongTermMemory(): any {
  if (!longTermMemoryInstance) {
    const { createLongTermMemory } = require('../../memory/long-term');
    longTermMemoryInstance = createLongTermMemory();
  }
  return longTermMemoryInstance;
}
