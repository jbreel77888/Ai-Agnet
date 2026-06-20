/**
 * Logger interface — Pino-based structured logger
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  fatal(msg: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
  setLevel(level: LogLevel): void;
}

export function createLogger(level: LogLevel = 'info'): Logger {
  // Lazy load pino to keep module testable
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pino = require('pino');
  const baseLogger = pino({
    level,
    transport: process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
    base: { service: process.env.SERVICE_NAME ?? 'agent-platform' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });

  return {
    debug: (msg, meta) => baseLogger.debug(meta, msg),
    info: (msg, meta) => baseLogger.info(meta, msg),
    warn: (msg, meta) => baseLogger.warn(meta, msg),
    error: (msg, meta) => baseLogger.error(meta, msg),
    fatal: (msg, meta) => baseLogger.fatal(meta, msg),
    child: (bindings) => createChildLogger(baseLogger.child(bindings)),
    setLevel: (lvl) => baseLogger.level = lvl,
  };
}

function createChildLogger(pinoChild: any): Logger {
  return {
    debug: (msg, meta) => pinoChild.debug(meta, msg),
    info: (msg, meta) => pinoChild.info(meta, msg),
    warn: (msg, meta) => pinoChild.warn(meta, msg),
    error: (msg, meta) => pinoChild.error(meta, msg),
    fatal: (msg, meta) => pinoChild.fatal(meta, msg),
    child: (bindings) => createChildLogger(pinoChild.child(bindings)),
    setLevel: (lvl) => pinoChild.level = lvl,
  };
}
