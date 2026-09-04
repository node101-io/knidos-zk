// A failure that is deterministic for the task's inputs - the same window
// would fail the same way on every retry - so the worker should mark the task
// FAILED immediately instead of burning its retry budget.
export class PermanentTaskError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PermanentTaskError';
  }
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function jsonSafeReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  return value;
}

export function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    const serialized: Record<string, unknown> = {};
    for (const key of new Set(['name', 'message', 'stack', ...Object.getOwnPropertyNames(err)])) {
      const value = (err as unknown as Record<string, unknown>)[key];
      serialized[key] = value instanceof Error ? serializeError(value) : value;
    }

    return JSON.parse(JSON.stringify(serialized, jsonSafeReplacer));
  }

  if (typeof err === 'object' && err !== null) {
    return JSON.parse(JSON.stringify(err, jsonSafeReplacer));
  }

  return { message: String(err) };
}

export function collectErrorStrings(err: unknown): string[] {
  const seen = new Set<unknown>();
  const values: string[] = [];

  function add(value: string): void {
    const normalized = normalizeText(value);
    if (normalized && !values.includes(normalized)) {
      values.push(normalized);
    }
  }

  function visit(value: unknown): void {
    if (value == null || seen.has(value)) return;

    if (typeof value === 'string') {
      add(value);
      if (value.startsWith('{') || value.startsWith('[')) {
        try {
          visit(JSON.parse(value));
        } catch {
          // Ignore non-JSON strings that only look like JSON.
        }
      }
      return;
    }

    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      add(String(value));
      return;
    }

    if (typeof value !== 'object') return;

    seen.add(value);
    if (value instanceof Error) {
      add(value.name);
      add(value.message);
      visit((value as Error & { cause?: unknown }).cause);

      for (const key of Object.getOwnPropertyNames(value)) {
        if (key === 'message' || key === 'name' || key === 'stack') continue;
        visit((value as unknown as Record<string, unknown>)[key]);
      }
    }
    for (const entry of Object.values(value as Record<string, unknown>)) {
      visit(entry);
    }
  }

  visit(err);
  return values;
}
