/**
 * Environment configuration
 * Validates required env vars on startup
 */
import { z } from 'zod';

const envSchema = z.object({
  // Core
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SERVICE_NAME: z.string().default('agent-platform'),
  PORT: z.coerce.number().default(3000),

  // Database
  DATABASE_URL: z.string().optional(),
  DATABASE_SSL: z.string().optional(),

  // Redis (optional - empty string allowed)
  REDIS_URL: z.string().optional().or(z.literal('')),

  // Embedded PostgreSQL
  PG_PORT: z.coerce.number().default(5433),
  PG_USER: z.string().default('postgres'),
  PG_PASSWORD: z.string().default('postgres'),
  PG_DB_NAME: z.string().default('agent_platform'),
  PG_DATA_DIR: z.string().optional(),
  PG_AUTO_START: z.string().default('true'),
  PG_RESET_ON_START: z.string().default('false'),

  // Encryption
  ENCRYPTION_KEY: z.string().optional(),

  // Auth
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars').optional(),
  JWT_ACCESS_TTL_MIN: z.coerce.number().default(15),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().default(7),

  // Observability
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  DB_LOG: z.string().optional(),
  OTL_EXPORTER_URL: z.string().url().optional(),

  // Storage
  STORAGE_BACKEND: z.enum(['local', 's3', 'r2', 'gcs']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./storage'),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_REGION: z.string().optional(),

  // Embeddings
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDING_DIMENSIONS: z.coerce.number().default(1536),

  // LLM Defaults (can be empty — added via admin UI)
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().optional(),

  // Tools
  TAVILY_API_KEY: z.string().optional(),
  SERPAPI_KEY: z.string().optional(),
  BRAVE_API_KEY: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
  NOTION_API_KEY: z.string().optional(),
  DISCORD_BOT_TOKEN: z.string().optional(),

  // Email
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
}).passthrough(); // Allow extra env vars without failing

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function loadEnv(): Env {
  if (cachedEnv) return cachedEnv;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('[env] Invalid environment variables:');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Invalid environment configuration');
    }
    // In dev, return undefined to signal issue (callers should handle)
    cachedEnv = {} as Env;
  } else {
    cachedEnv = result.data;
  }

  return cachedEnv;
}

export function getEnv(): Env {
  return cachedEnv ?? loadEnv();
}
