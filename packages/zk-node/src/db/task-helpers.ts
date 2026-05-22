import type { ClientSession, UpdateQuery } from 'mongoose';

import { Task, type TaskInterface, type TaskStatus, type TaskType } from './task.js';

import { parseTaskInput } from '../pipelines/validation.js';

interface CreateTaskBody {
  type: TaskType;
  input: Record<string, unknown>;
}

interface CreateTaskOptions {
  session?: ClientSession;
}

interface UpdateTaskStatusBody {
  taskId: string;
  status: TaskStatus;
  result?: unknown;
  error?: unknown;
  deferUntil?: Date | null;
  deferReason?: string | null;
  deferCount?: number | null;
}

interface UpdateTaskStatusOptions {
  session?: ClientSession;
}

export async function createTask(
  body: CreateTaskBody,
  options?: CreateTaskOptions,
): Promise<TaskInterface> {
  const input = parseTaskInput(body.type, body.input);
  const [task] = await Task.create(
    [
      {
        type: body.type,
        input,
      },
    ],
    options?.session ? { session: options.session } : undefined,
  );

  if (!task) {
    throw new Error('[task] failed to create task document');
  }

  return task;
}

export async function markTaskQueued(taskId: string): Promise<void> {
  await Task.updateOne(
    { _id: taskId },
    {
      $set: { status: 'QUEUED' },
      $unset: { deferUntil: '', deferReason: '' },
    },
  );
}

export async function updateTaskStatus(
  body: UpdateTaskStatusBody,
  options?: UpdateTaskStatusOptions,
): Promise<void> {
  const $set: Record<string, unknown> = { status: body.status };
  const update: UpdateQuery<TaskInterface> = { $set };

  if (body.status !== 'COMPLETED') {
    $set.finishedAt = null;
    if (body.result === undefined) $set.result = null;
  }

  if (body.status !== 'DEFERRED') {
    $set.deferUntil = null;
    $set.deferReason = null;
  }

  if (body.status === 'DEFERRED') {
    $set.deferUntil = body.deferUntil ?? null;
    $set.deferReason = body.deferReason ?? null;
  }

  if (body.status === 'COMPLETED') {
    $set.finishedAt = new Date();
    $set.result = body.result ?? null;
    $set.error = null;
  }

  if (body.deferCount !== undefined) {
    $set.deferCount = body.deferCount;
  }

  if (body.error !== undefined) {
    $set.error = body.error;
  }

  if (options?.session) {
    await Task.updateOne({ _id: body.taskId }, update, { session: options.session });
    return;
  }

  await Task.updateOne({ _id: body.taskId }, update);
}

export async function setPrimusCheckpoint(taskId: string, checkpoint: unknown): Promise<void> {
  await Task.updateOne({ _id: taskId }, { $set: { primus: checkpoint } });
}

export async function clearPrimusCheckpoint(taskId: string): Promise<void> {
  await Task.updateOne({ _id: taskId }, { $unset: { primus: '' } });
}
