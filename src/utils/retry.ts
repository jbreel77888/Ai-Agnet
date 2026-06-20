/**
 * Retry utility — exponential backoff with jitter
 *
 * Usage:
 *   const result = await withRetry(
 *     () => fetch(url),
 *     { maxAttempts: 3, strategy: 'exponential', initialDelayMs: 1000 }
 *   );
 */

export interface RetryConfig {
  maxAttempts: number;
  strategy: 'none' | 'exponential' | 'linear';
  initialDelayMs: number;
  maxDelayMs: number;
  jitterMs?: number;
  retryOn?: (err: unknown, attempt: number) => boolean;
  onRetry?: (err: unknown, attempt: number, nextDelayMs: number) => void;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  strategy: 'exponential',
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  jitterMs: 500,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const fullConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: unknown;

  for (let attempt = 1; attempt <= fullConfig.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt === fullConfig.maxAttempts) break;
      if (fullConfig.retryOn && !fullConfig.retryOn(err, attempt)) break;

      const delay = computeDelay(attempt, fullConfig);
      fullConfig.onRetry?.(err, attempt, delay);
      await sleep(delay);
    }
  }

  throw lastError;
}

function computeDelay(attempt: number, config: RetryConfig): number {
  let delay: number;
  switch (config.strategy) {
    case 'none':
      delay = 0;
      break;
    case 'linear':
      delay = config.initialDelayMs * attempt;
      break;
    case 'exponential':
    default:
      delay = config.initialDelayMs * Math.pow(2, attempt - 1);
      break;
  }
  delay = Math.min(delay, config.maxDelayMs);

  // Add jitter to avoid thundering herd
  if (config.jitterMs) {
    delay += Math.random() * config.jitterMs;
  }

  return Math.floor(delay);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Timeout wrapper
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  errorMessage = 'Operation timed out'
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new TimeoutError(errorMessage, timeoutMs)), timeoutMs);
  });

  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle!);
  }
}

export class TimeoutError extends Error {
  constructor(message: string, public readonly timeoutMs: number) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Compose withRetry + withTimeout for typical provider calls
 */
export async function withRetryAndTimeout<T>(
  fn: () => Promise<T>,
  opts: { timeoutMs: number; retryConfig?: Partial<RetryConfig> }
): Promise<T> {
  return withRetry(
    () => withTimeout(fn, opts.timeoutMs),
    opts.retryConfig
  );
}
