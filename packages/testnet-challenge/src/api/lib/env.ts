import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  MONGO_URI: z.string().min(1),
  // Shared with the zk-node API. Required for /api/completed access.
  API_KEY: z.string().min(1),
});

export const env = schema.parse(process.env);
