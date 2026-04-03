import type { SagaMonitor, Effect, Task } from './types';

export interface SagaMonitorOptions {
  /** Custom log function. Defaults to `console.log`. */
  log?: (...args: unknown[]) => void;
  /** Include effect results in output. Defaults to `false`. */
  verbose?: boolean;
  /** Filter which effect types to log. Defaults to all. */
  filter?: string[];
}

function effectLabel(effect: Effect): string {
  return effect.type.description ?? 'UNKNOWN';
}

function effectDetail(effect: Effect): string {
  const label = effectLabel(effect);
  switch (label) {
    case 'TAKE':
    case 'TAKE_MAYBE':
      return 'pattern' in effect && effect.pattern
        ? `${label}(${formatPattern(effect.pattern)})`
        : `${label}(channel)`;
    case 'PUT':
      return `PUT(${(effect as any).action?.type ?? '?'})`;
    case 'CALL':
      return `CALL(${(effect as any).fn?.name || 'anonymous'})`;
    case 'FORK':
    case 'SPAWN':
      return `${label}(${(effect as any).saga?.name || 'anonymous'})`;
    case 'DELAY':
      return `DELAY(${(effect as any).ms}ms)`;
    case 'SELECT':
      return (effect as any).selector ? 'SELECT(fn)' : 'SELECT()';
    case 'RETRY':
      return `RETRY(${(effect as any).maxTries}x, ${(effect as any).delayMs}ms, ${(effect as any).fn?.name || 'anonymous'})`;
    case 'RACE':
      return `RACE(${Object.keys((effect as any).effects || {}).join(', ')})`;
    case 'ALL':
      return `ALL(${((effect as any).effects || []).length} effects)`;
    case 'ALL_SETTLED':
      return `ALL_SETTLED(${((effect as any).effects || []).length} effects)`;
    case 'UNTIL':
      return typeof (effect as any).predicate === 'string'
        ? `UNTIL(${(effect as any).predicate})`
        : 'UNTIL(fn)';
    default:
      return label;
  }
}

function formatPattern(pattern: unknown): string {
  if (typeof pattern === 'string') return `'${pattern}'`;
  if (typeof pattern === 'function') return pattern.name || 'fn';
  if (Array.isArray(pattern)) return `[${pattern.map(formatPattern).join(', ')}]`;
  return String(pattern);
}

function taskTag(task: Task): string {
  return `[task:${task.id}]`;
}

/**
 * Creates a saga monitor that logs effect execution, timing, task lifecycle,
 * and errors to the console (or a custom log function).
 */
export function createSagaMonitor(options: SagaMonitorOptions = {}): SagaMonitor {
  const { log = console.log, verbose = false, filter } = options;
  const timers = new WeakMap<Effect, number>();

  function shouldLog(effect: Effect): boolean {
    if (!filter) return true;
    const label = effectLabel(effect);
    return filter.includes(label);
  }

  return {
    onTaskStart(task: Task, saga, _args) {
      log(`${taskTag(task)} started  ${saga.name || 'anonymous'}`);
    },

    onTaskResult(task: Task, result) {
      if (verbose) {
        log(`${taskTag(task)} done    `, result);
      } else {
        log(`${taskTag(task)} done`);
      }
    },

    onTaskError(task: Task, error) {
      log(`${taskTag(task)} error   `, error instanceof Error ? error.message : error);
    },

    onTaskCancel(task: Task) {
      log(`${taskTag(task)} cancel`);
    },

    onEffectStart(task: Task, effect: Effect) {
      if (!shouldLog(effect)) return;
      timers.set(effect, performance.now());
      log(`${taskTag(task)} >> ${effectDetail(effect)}`);
    },

    onEffectResult(task: Task, effect: Effect, result) {
      if (!shouldLog(effect)) return;
      let duration = '';
      const start = timers.get(effect);
      if (start !== undefined) {
        timers.delete(effect);
        duration = ` (${(performance.now() - start).toFixed(1)}ms)`;
      }
      if (verbose) {
        log(`${taskTag(task)} << ${effectDetail(effect)}${duration}`, result);
      } else {
        log(`${taskTag(task)} << ${effectDetail(effect)}${duration}`);
      }
    },

    onEffectError(task: Task, effect: Effect, error) {
      if (!shouldLog(effect)) return;
      timers.delete(effect);
      log(
        `${taskTag(task)} !! ${effectDetail(effect)}`,
        error instanceof Error ? error.message : error,
      );
    },
  };
}
