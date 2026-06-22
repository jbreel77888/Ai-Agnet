/**
 * BullMQ Queue definitions — all queues in the system
 */
import { Queue, QueueEvents } from 'bullmq';
import { getRedisConnection } from '../../db/redis';

export const QUEUES = {
  AGENT_EXECUTION: 'agent-execution',
  TOOL_EXECUTION: 'tool-execution',
  WORKFLOW_EXECUTION: 'workflow-execution',
  RAG_INGESTION: 'rag-ingestion',
  MEMORY_BACKGROUND: 'memory-background',
  MCP_HEALTH_CHECK: 'mcp-health-check',
  COST_RECORDING: 'cost-recording',
  EMBEDDING_GENERATION: 'embedding-generation',
  PROVIDER_HEALTH_CHECK: 'provider-health-check',
  SCHEDULED_WORKFLOWS: 'scheduled-workflows',
  EMAIL_SENDING: 'email-sending',
  CLEANUP: 'cleanup',
} as const;

export type QueueName = typeof QUEUES[keyof typeof QUEUES];

const queueInstances = new Map<string, Queue>();
const queueEventsInstances = new Map<string, QueueEvents>();

export function getQueue<T = unknown>(name: QueueName): Queue<T> {
  if (!queueInstances.has(name)) {
    const queue = new Queue<T>(name, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 100, age: 24 * 60 * 60 },
        removeOnFail: { count: 500, age: 7 * 24 * 60 * 60 },
      },
    });
    queueInstances.set(name, queue as any);
  }
  return queueInstances.get(name) as Queue<T>;
}

export function getQueueEvents(name: QueueName): QueueEvents {
  if (!queueEventsInstances.has(name)) {
    const events = new QueueEvents(name, { connection: getRedisConnection() });
    queueEventsInstances.set(name, events);
  }
  return queueEventsInstances.get(name)!;
}

export async function closeAllQueues(): Promise<void> {
  for (const queue of queueInstances.values()) {
    await queue.close();
  }
  for (const events of queueEventsInstances.values()) {
    await events.close();
  }
  queueInstances.clear();
  queueEventsInstances.clear();
}
