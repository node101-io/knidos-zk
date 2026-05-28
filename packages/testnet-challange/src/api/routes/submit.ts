import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import { expectedVerdicts, getCorruptionMask, scoreAnswers } from '../../corruption.js';
import { parseSiweMessage, verifySiwePersonalSig } from '../../siwe-lite.js';
import {
  ANSWER_VERDICTS,
  PASS_THRESHOLD,
  RECORD_COUNT,
  type AnswerVerdict,
} from '../../types.js';
import { CompletedAddress } from '../db/completed-address.js';
import { errorResponse, errorSchema, validationHook } from '../lib/openapi.js';

const submitRequestSchema = z
  .object({
    message: z.string().min(1).openapi({
      description: 'The exact SIWE message the user signed in their wallet.',
      example:
        'localhost wants you to sign in with your Ethereum account:\n0x...\n\nSign in to Knidos Testnet Challenge.\n\nURI: http://localhost\nVersion: 1\nChain ID: 1\nNonce: ...\nIssued At: ...\nExpiration Time: ...',
    }),
    signature: z
      .string()
      .regex(/^0x[0-9a-fA-F]+$/)
      .openapi({
        description: 'Hex-encoded `personal_sign` signature over `message`.',
        example: '0xabc123…',
      }),
    answers: z
      .array(z.enum(ANSWER_VERDICTS as unknown as [AnswerVerdict, ...AnswerVerdict[]]))
      .length(RECORD_COUNT)
      .openapi({
        description: `One verdict per presented record (exactly ${RECORD_COUNT}).`,
        example: ['valid', 'invalid', 'invalid', 'valid', 'invalid'] as AnswerVerdict[],
      }),
  })
  .openapi('SubmitRequest');

const submitResponseSchema = z
  .object({
    passed: z
      .boolean()
      .openapi({ description: `True when score >= ${PASS_THRESHOLD}.` }),
    score: z
      .number()
      .int()
      .min(0)
      .max(RECORD_COUNT)
      .openapi({ description: `Number of correct verdicts (0..${RECORD_COUNT}).` }),
  })
  .openapi('SubmitResponse');

const submitRoute = createRoute({
  method: 'post',
  path: '/api/submit',
  tags: ['challenge'],
  summary: 'Grade a challenge attempt',
  description: `Verifies the SIWE signature, recomputes the expected verdicts from the recovered address, and grades the submitted answers. Addresses scoring at least ${PASS_THRESHOLD}/${RECORD_COUNT} are recorded as completed (best score wins).`,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: submitRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Attempt graded.',
      content: { 'application/json': { schema: submitResponseSchema } },
    },
    400: errorResponse('Malformed body or unparseable SIWE message.'),
    401: errorResponse('Signature expired or did not verify.'),
  },
});

export const submitRoutes = new OpenAPIHono({ defaultHook: validationHook });

submitRoutes.openapi(submitRoute, async (c) => {
  const { message, signature, answers } = c.req.valid('json');

  let parsedMsg;
  try {
    parsedMsg = parseSiweMessage(message);
  } catch {
    return c.json(
      { error: 'We could not read your wallet signature. Re-run the CLI and sign again.' },
      400,
    );
  }

  if (parsedMsg.expirationTime) {
    const exp = new Date(parsedMsg.expirationTime).getTime();
    if (!Number.isFinite(exp) || exp < Date.now()) {
      return c.json(
        {
          error:
            'Your wallet signature has expired (signatures are valid for ~10 minutes). Re-run the CLI to sign again.',
        },
        401,
      );
    }
  }

  let address: string;
  try {
    address = verifySiwePersonalSig(message, signature);
  } catch {
    return c.json(
      { error: 'We could not verify your wallet signature. Re-run the CLI and sign again.' },
      401,
    );
  }

  const expected = expectedVerdicts(getCorruptionMask(address));
  const score = scoreAnswers(expected, answers as AnswerVerdict[]);
  const passed = score >= PASS_THRESHOLD;

  if (passed) {
    // `$max` ensures a repeated attempt only raises the stored score; an
    // address that previously scored 5 can't be downgraded by later 3s.
    await CompletedAddress.updateOne(
      { address },
      { $max: { score }, $setOnInsert: { address } },
      { upsert: true },
    );
  }

  return c.json({ passed, score }, 200);
});

export { errorSchema };
