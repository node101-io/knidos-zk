import { z } from 'zod';

import { normalizeDateInput } from '../shared/date-utils.js';
import { PROOF_TYPE } from './types.js';
import type { NoirCircuitInput, NoirJobInput, ZkTLSJobInput, ZkVerifyJobInput } from './types.js';

type PipelineTaskType = 'zkTLS' | 'noir' | 'zkVerify';
type TaskInputRecord = Record<string, unknown>;

const MAX_RAW_FILLS_LENGTH = 8192;
const FIELD_PAIR_LENGTH = 2;
const ADDRESS_STRING_LENGTH = 42;
const SALT_LENGTH = 16;

const byteSchema = z.number().int().min(0).max(255);
const fieldStringSchema = z.string().min(1);
const dateInputSchema = z.preprocess((value) => normalizeDateInput(value) ?? value, z.date());

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length === 0 ? 'input' : issue.path.join('.');
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown, label: string): T {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }

  throw new Error(`[validation] invalid ${label}: ${formatZodError(result.error)}`);
}

export const zkTLSJobInputSchema = z
  .object({
    startTime: dateInputSchema,
    endTime: dateInputSchema,
    proofType: z.literal(PROOF_TYPE).optional(),
    baseBalance: z.number().int(),
    threshold: z.number().int(),
  })
  .strict();

export const noirCircuitInputSchema = z
  .object({
    addressCommitment: z.array(fieldStringSchema).length(FIELD_PAIR_LENGTH),
    fillsCommitment: z.array(fieldStringSchema).length(FIELD_PAIR_LENGTH),
    address: z.array(byteSchema).length(ADDRESS_STRING_LENGTH),
    addressSalt: z.array(byteSchema).length(SALT_LENGTH),
    fillsSalt: z.array(byteSchema).length(SALT_LENGTH),
    rawFills: z.array(byteSchema).length(MAX_RAW_FILLS_LENGTH),
    rawFillsLength: z.number().int().min(0).max(MAX_RAW_FILLS_LENGTH),
    startTime: z.number().int(),
    endTime: z.number().int(),
    baseBalance: z.number().int(),
    threshold: z.number().int(),
  })
  .strict();

export const noirJobInputSchema = z
  .object({
    zkTLSTaskId: z.string().min(1),
    startTime: dateInputSchema,
    endTime: dateInputSchema,
    circuitInput: noirCircuitInputSchema,
  })
  .strict();

export const zkVerifyJobInputSchema = z
  .object({
    noirTaskId: z.string().min(1),
    startTime: dateInputSchema,
    endTime: dateInputSchema,
  })
  .strict();

export function parseZkTLSJobInput(input: unknown): ZkTLSJobInput {
  const parsedInput = parseWithSchema(zkTLSJobInputSchema, input, 'zkTLS job input');

  if (parsedInput.proofType === undefined) {
    return {
      startTime: parsedInput.startTime,
      endTime: parsedInput.endTime,
      baseBalance: parsedInput.baseBalance,
      threshold: parsedInput.threshold,
    };
  }

  return {
    startTime: parsedInput.startTime,
    endTime: parsedInput.endTime,
    proofType: parsedInput.proofType,
    baseBalance: parsedInput.baseBalance,
    threshold: parsedInput.threshold,
  };
}

export function parseNoirCircuitInput(input: unknown): NoirCircuitInput {
  return parseWithSchema(noirCircuitInputSchema, input, 'noir circuit input');
}

export function parseNoirJobInput(input: unknown): NoirJobInput {
  return parseWithSchema(noirJobInputSchema, input, 'noir job input');
}

export function parseZkVerifyJobInput(input: unknown): ZkVerifyJobInput {
  return parseWithSchema(zkVerifyJobInputSchema, input, 'zkVerify job input');
}

export function parseTaskInput(type: PipelineTaskType, input: unknown): TaskInputRecord {
  if (type === 'zkTLS') {
    return parseZkTLSJobInput(input) as unknown as TaskInputRecord;
  }

  if (type === 'noir') {
    return parseNoirJobInput(input) as unknown as TaskInputRecord;
  }

  return parseZkVerifyJobInput(input) as unknown as TaskInputRecord;
}
