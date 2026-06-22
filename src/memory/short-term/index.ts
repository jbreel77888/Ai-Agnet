/**
 * Short-Term Memory (Redis-backed)
 */
import { getRedis } from '../../db/redis';
import type { ShortTermMemory } from './types';
import type { ChatMessage } from '../../types';

const SESSION_TTL_SEC = 24 * 60 * 60; // 24 hours
const MESSAGE_LIST_KEY = (sessionId: string) => `session:${sessionId}:messages`;
const VARS_KEY = (sessionId: string) => `session:${sessionId}:vars`;
const AGENT_STATE_KEY = (sessionId: string, agentId: string) => `session:${sessionId}:agent:${agentId}:state`;
const SESSION_TOUCH_KEY = (sessionId: string) => `session:${sessionId}:touch`;

export function createShortTermMemory(): ShortTermMemory {
  const redis = getRedis();

  const addMessage = async (sessionId: string, msg: ChatMessage): Promise<void> => {
    const serialized = JSON.stringify(msg);
    await redis.lpush(MESSAGE_LIST_KEY(sessionId), serialized);
    // Cap at 500 messages per session
    await redis.ltrim(MESSAGE_LIST_KEY(sessionId), 0, 499);
    await redis.expire(MESSAGE_LIST_KEY(sessionId), SESSION_TTL_SEC);
    await touchSession(sessionId);
  };

  const getMessages = async (sessionId: string, opts?: {
    limit?: number;
    since?: Date;
    role?: ChatMessage['role'];
  }): Promise<ChatMessage[]> => {
    const limit = opts?.limit ?? 100;
    const raw = await redis.lrange(MESSAGE_LIST_KEY(sessionId), 0, limit - 1);
    let messages: ChatMessage[] = raw.map(s => JSON.parse(s as string));

    if (opts?.since) {
      messages = messages.filter(m => {
        // If message has a timestamp in metadata, filter by it
        // Otherwise include all (we don't have per-message timestamps in this format)
        return true;
      });
    }

    if (opts?.role) {
      messages = messages.filter(m => m.role === opts.role);
    }

    return messages;
  };

  const clearMessages = async (sessionId: string): Promise<void> => {
    await redis.del(MESSAGE_LIST_KEY(sessionId));
  };

  const countMessages = async (sessionId: string): Promise<number> => {
    return await redis.llen(MESSAGE_LIST_KEY(sessionId)) as number;
  };

  const setVar = async (sessionId: string, key: string, value: unknown, ttlSec?: number): Promise<void> => {
    const fullKey = `${VARS_KEY(sessionId)}:${key}`;
    await redis.set(fullKey, JSON.stringify(value));
    if (ttlSec) {
      await redis.expire(fullKey, ttlSec);
    } else {
      await redis.expire(fullKey, SESSION_TTL_SEC);
    }
    await touchSession(sessionId);
  };

  const getVar = async <T>(sessionId: string, key: string): Promise<T | undefined> => {
    const raw = await redis.get(`${VARS_KEY(sessionId)}:${key}`);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw as string) as T;
    } catch {
      return undefined;
    }
  };

  const deleteVar = async (sessionId: string, key: string): Promise<void> => {
    await redis.del(`${VARS_KEY(sessionId)}:${key}`);
  };

  const getAllVars = async (sessionId: string): Promise<Record<string, unknown>> => {
    // Note: ioredis keys() can be slow on large Redis — use only for debugging/admin
    const pattern = `${VARS_KEY(sessionId)}:*`;
    const keys = await redis.keys(pattern);
    const result: Record<string, unknown> = {};
    for (const k of keys) {
      const key = (k as string).split(':').slice(3).join(':');
      const value = await redis.get(k);
      try {
        result[key] = JSON.parse(value as string);
      } catch {
        result[key] = value;
      }
    }
    return result;
  };

  const setAgentState = async (sessionId: string, agentId: string, state: unknown): Promise<void> => {
    const key = AGENT_STATE_KEY(sessionId, agentId);
    await redis.set(key, JSON.stringify(state));
    await redis.expire(key, SESSION_TTL_SEC);
    await touchSession(sessionId);
  };

  const getAgentState = async <T>(sessionId: string, agentId: string): Promise<T | undefined> => {
    const raw = await redis.get(AGENT_STATE_KEY(sessionId, agentId));
    if (!raw) return undefined;
    try {
      return JSON.parse(raw as string) as T;
    } catch {
      return undefined;
    }
  };

  const touchSession = async (sessionId: string): Promise<void> => {
    await redis.set(SESSION_TOUCH_KEY(sessionId), Date.now().toString());
    await redis.expire(SESSION_TOUCH_KEY(sessionId), SESSION_TTL_SEC);
  };

  const isSessionActive = async (sessionId: string): Promise<boolean> => {
    const exists = await redis.exists(SESSION_TOUCH_KEY(sessionId));
    return exists === 1;
  };

  const setSessionExpiry = async (sessionId: string, ttlSec: number): Promise<void> => {
    await redis.expire(MESSAGE_LIST_KEY(sessionId), ttlSec);
    await redis.expire(VARS_KEY(sessionId), ttlSec);
    await redis.expire(SESSION_TOUCH_KEY(sessionId), ttlSec);
  };

  const persistSession = async (_sessionId: string): Promise<void> => {
    // Messages are already persisted to PostgreSQL via API routes
    // This is a no-op hook for additional persistence if needed
  };

  const restoreSession = async (_sessionId: string): Promise<void> => {
    // Messages are restored from PostgreSQL via API routes
    // This is a no-op hook
  };

  return {
    addMessage,
    getMessages,
    clearMessages,
    countMessages,
    setVar,
    getVar,
    deleteVar,
    getAllVars,
    setAgentState,
    getAgentState,
    touchSession,
    isSessionActive,
    setSessionExpiry,
    persistSession,
    restoreSession,
  };
}
