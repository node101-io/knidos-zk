function isValidDate(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

export function normalizeDateInput(value: unknown): Date | null {
  if (value instanceof Date) {
    return isValidDate(value) ? new Date(value.getTime()) : null;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return isValidDate(date) ? date : null;
  }

  return null;
}

export function parseDateInput(value: unknown, label: string): Date {
  const date = normalizeDateInput(value);
  if (date) {
    return date;
  }

  throw new Error(`[date] invalid ${label}`);
}

export function toTimestampMs(date: Date): number {
  const timestamp = date.getTime();
  if (Number.isNaN(timestamp)) {
    throw new Error('[date] invalid Date instance');
  }

  return timestamp;
}
