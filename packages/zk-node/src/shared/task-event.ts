import { performance } from 'node:perf_hooks';

export interface TaskEventCtx {
  set(fields: Record<string, unknown>): void;
  bump(key: string, by?: number): void;
  timer(label: string): () => void;
  snapshot(): Record<string, unknown>;
}

export function createTaskEventCtx(base: Record<string, unknown>): TaskEventCtx {
  const data: Record<string, unknown> = { ...base };
  return {
    set(fields) {
      Object.assign(data, fields);
    },
    bump(key, by = 1) {
      const cur = typeof data[key] === 'number' ? (data[key] as number) : 0;
      data[key] = cur + by;
    },
    timer(label) {
      const start = performance.now();
      return () => {
        data[`${label}_ms`] = Math.round(performance.now() - start);
      };
    },
    snapshot() {
      return { ...data };
    },
  };
}
