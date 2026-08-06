import { z } from 'zod';

export const zkTLSWindowMinutesSchema = z.coerce
  .number()
  .int()
  .positive()
  .refine(
    (minutes) =>
      minutes < 60 ? 60 % minutes === 0 : minutes % 60 === 0 && (24 * 60) % minutes === 0,
    'ZKTLS_WINDOW_MINUTES must evenly divide an hour, or be a whole-hour divisor of one day',
  )
  .default(60);
