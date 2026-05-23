import { Hono } from 'hono';
import { z } from 'zod';

import { expectedVerdicts, getCorruptionMask, scoreAnswers } from '../../corruption.js';
import { parseSiweMessage, verifySiwePersonalSig } from '../../siwe-lite.js';
import { ANSWER_VERDICTS, RECORD_COUNT, type AnswerVerdict } from '../../types.js';
import { CompletedAddress } from '../db/completed-address.js';

const bodySchema = z.object({
  message: z.string().min(1),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  answers: z
    .array(z.enum(ANSWER_VERDICTS as unknown as [string, ...string[]]))
    .length(RECORD_COUNT),
});

export const submitRoutes = new Hono();

submitRoutes.post('/api/submit', async (c) => {
  const json = await c.req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: 'invalid body' }, 400);
  }

  const { message, signature, answers } = parsed.data;

  let parsedMsg;
  try {
    parsedMsg = parseSiweMessage(message);
  } catch {
    return c.json({ error: 'malformed SIWE message' }, 400);
  }

  // Reject expired signatures so a captured sig can't be replayed forever.
  if (parsedMsg.expirationTime) {
    const exp = new Date(parsedMsg.expirationTime).getTime();
    if (!Number.isFinite(exp) || exp < Date.now()) {
      return c.json({ error: 'SIWE message expired' }, 401);
    }
  }

  let address: string;
  try {
    address = verifySiwePersonalSig(message, signature);
  } catch {
    return c.json({ error: 'signature verification failed' }, 401);
  }

  const expected = expectedVerdicts(getCorruptionMask(address));
  const score = scoreAnswers(expected, answers as AnswerVerdict[]);
  const passed = score === RECORD_COUNT;

  if (passed) {
    await CompletedAddress.updateOne(
      { address },
      { $setOnInsert: { address } },
      { upsert: true },
    );
  }

  return c.json({ passed, score });
});
