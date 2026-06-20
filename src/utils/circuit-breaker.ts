/**
 * Circuit Breaker — protects against cascading failures
 *
 * States:
 * - CLOSED: requests flow normally
 * - OPEN: requests fail-fast (after threshold failures)
 * - HALF_OPEN: one trial request allowed
 *
 * Default config:
 * - failureThreshold: 5 failures in window
 * - windowMs: 10 seconds
 * - openMs: 30 seconds (time to wait before half-open)
 */

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  windowMs: number;
  openMs: number;
  halfOpenMaxCalls: number;
  shouldTripOnError?: (err: unknown) => boolean;
}

export interface CircuitBreaker {
  execute<T>(fn: () => Promise<T>): Promise<T>;
  getState(): CircuitState;
  getMetrics(): {
    state: CircuitState;
    failures: number;
    successes: number;
    lastFailureAt?: Date;
    lastSuccessAt?: Date;
    rejectedCount: number;
  };
  reset(): void;
}

export function createCircuitBreaker(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
  const fullConfig: CircuitBreakerConfig = {
    failureThreshold: 5,
    windowMs: 10000,
    openMs: 30000,
    halfOpenMaxCalls: 1,
    shouldTripOnError: () => true,
    ...config,
  };

  let state: CircuitState = 'closed';
  let failures = 0;
  let successes = 0;
  let rejectedCount = 0;
  let lastFailureAt: Date | undefined;
  let lastSuccessAt: Date | undefined;
  let openedAt: Date | undefined;
  let halfOpenCalls = 0;
  const failureTimestamps: Date[] = [];

  const pruneFailures = () => {
    const cutoff = Date.now() - fullConfig.windowMs;
    while (failureTimestamps.length > 0 && failureTimestamps[0].getTime() < cutoff) {
      failureTimestamps.shift();
    }
  };

  const trip = () => {
    state = 'open';
    openedAt = new Date();
    console.warn(`[circuit:${name}] Tripped to OPEN (failures=${failures})`);
  };

  const reset = () => {
    state = 'closed';
    failures = 0;
    halfOpenCalls = 0;
    openedAt = undefined;
    failureTimestamps.length = 0;
  };

  const halfOpen = () => {
    state = 'half_open';
    halfOpenCalls = 0;
  };

  const execute = async <T>(fn: () => Promise<T>): Promise<T> => {
    // Check if should transition from open → half_open
    if (state === 'open' && openedAt) {
      if (Date.now() - openedAt.getTime() > fullConfig.openMs) {
        halfOpen();
      } else {
        rejectedCount++;
        throw new CircuitOpenError(name, 'Circuit breaker is OPEN');
      }
    }

    if (state === 'half_open' && halfOpenCalls >= fullConfig.halfOpenMaxCalls) {
      rejectedCount++;
      throw new CircuitOpenError(name, 'Circuit breaker HALF_OPEN at max calls');
    }

    if (state === 'half_open') halfOpenCalls++;

    try {
      const result = await fn();
      lastSuccessAt = new Date();
      successes++;

      if (state === 'half_open') {
        reset();
      }

      return result;
    } catch (err) {
      lastFailureAt = new Date();

      if (fullConfig.shouldTripOnError!(err)) {
        failureTimestamps.push(new Date());
        pruneFailures();
        failures = failureTimestamps.length;

        if (state === 'half_open') {
          trip();
        } else if (failures >= fullConfig.failureThreshold) {
          trip();
        }
      }

      throw err;
    }
  };

  return {
    execute,
    getState: () => state,
    getMetrics: () => ({
      state, failures, successes, lastFailureAt, lastSuccessAt, rejectedCount,
    }),
    reset,
  };
}

export class CircuitOpenError extends Error {
  constructor(public readonly circuitName: string, message: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}
