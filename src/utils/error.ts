export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null) {
    if ('message' in err && typeof (err as Record<string, unknown>).message === 'string') {
      return (err as Record<string, unknown>).message as string;
    }
    return JSON.stringify(err);
  }
  return String(err);
}

function jsonSafeReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  return value;
}

export function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    const base: Record<string, unknown> = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };

    for (const [key, value] of Object.entries(err as unknown as Record<string, unknown>)) {
      base[key] = value;
    }

    return JSON.parse(JSON.stringify(base, jsonSafeReplacer));
  }

  if (typeof err === 'object' && err !== null) {
    return JSON.parse(JSON.stringify(err, jsonSafeReplacer));
  }

  return { message: extractErrorMessage(err) };
}

export function collectErrorStrings(err: unknown): string[] {
  const seen = new Set<unknown>();
  const values: string[] = [];

  function visit(value: unknown): void {
    if (value == null || seen.has(value)) return;
    if (typeof value === 'string') {
      values.push(value);
      return;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      values.push(String(value));
      return;
    }
    if (typeof value !== 'object') return;

    seen.add(value);
    if (value instanceof Error) {
      if (value.message) values.push(value.message);
      if (value.name) values.push(value.name);
    }
    for (const entry of Object.values(value as Record<string, unknown>)) {
      visit(entry);
    }
  }

  visit(err);
  return values;
}
