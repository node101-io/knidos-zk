import mongoose, { Schema, Model, Types } from 'mongoose';
import type { UpdateQuery } from 'mongoose';
import { Buffer } from 'buffer';

import { parseTaskInput } from '../pipelines/validation.js';

const MAX_INPUT_SIZE = 1e5;

export type TaskType = 'zkTLS' | 'noir' | 'zkVerify';
export type TaskStatus = 'PENDING' | 'QUEUED' | 'RUNNING' | 'DEFERRED' | 'COMPLETED' | 'FAILED';

interface TaskInterface {
  _id: Types.ObjectId;
  type: TaskType;
  status: TaskStatus;
  deferUntil?: Date;
  deferReason?: string;
  deferCount?: number;
  finishedAt?: Date;
  input: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
  primus?: unknown;
}

interface CreateTaskBody {
  type: TaskType;
  input: Record<string, unknown>;
}

interface CreateTaskOptions {
  session?: mongoose.ClientSession;
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
  session?: mongoose.ClientSession;
}

export interface TaskModel extends Model<TaskInterface> {
  createTask(body: CreateTaskBody, options?: CreateTaskOptions): Promise<TaskInterface>;

  markTaskQueued(taskId: string): Promise<void>;

  updateTaskStatus(body: UpdateTaskStatusBody, options?: UpdateTaskStatusOptions): Promise<void>;

  setPrimusCheckpoint(taskId: string, checkpoint: unknown): Promise<void>;

  clearPrimusCheckpoint(taskId: string): Promise<void>;
}

const TaskSchema = new Schema<TaskInterface, TaskModel>({
  type: {
    type: String,
    required: true,
    enum: ['zkTLS', 'noir', 'zkVerify'],
    index: true,
  },
  status: {
    type: String,
    required: true,
    enum: ['PENDING', 'QUEUED', 'RUNNING', 'DEFERRED', 'COMPLETED', 'FAILED'],
    index: true,
    default: 'PENDING',
  },
  deferUntil: { type: Date, default: null },
  deferReason: { type: String, default: null },
  deferCount: { type: Number, default: 0 },
  finishedAt: { type: Date },
  input: {
    type: Schema.Types.Mixed,
    required: true,
    validate: {
      validator: function (value: unknown) {
        const size = Buffer.byteLength(JSON.stringify(value), 'utf8');
        return size <= MAX_INPUT_SIZE;
      },
      message: 'bad_request',
    },
  },
  result: {
    type: Schema.Types.Mixed,
    default: null,
  },
  error: {
    type: Schema.Types.Mixed,
    default: null,
  },
  primus: {
    type: Schema.Types.Mixed,
    default: null,
  },
});

TaskSchema.index(
  { type: 1, 'input.startTime': 1, 'input.endTime': 1, 'input.symbol': 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: 'zkTLS',
    },
  },
);

TaskSchema.index({ type: 1, status: 1, deferUntil: 1, 'input.endTime': 1, _id: 1 });

TaskSchema.statics.createTask = async function (
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
};

TaskSchema.statics.markTaskQueued = async function (taskId: string) {
  await Task.updateOne(
    { _id: taskId },
    {
      $set: { status: 'QUEUED' },
      $unset: { deferUntil: '', deferReason: '' },
    },
  );
};

TaskSchema.statics.updateTaskStatus = async function (
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
};

TaskSchema.statics.setPrimusCheckpoint = async function (
  taskId: string,
  checkpoint: unknown,
): Promise<void> {
  await Task.updateOne({ _id: taskId }, { $set: { primus: checkpoint } });
};

TaskSchema.statics.clearPrimusCheckpoint = async function (taskId: string): Promise<void> {
  await Task.updateOne({ _id: taskId }, { $unset: { primus: '' } });
};

const Task = mongoose.model<TaskInterface, TaskModel>('Task', TaskSchema);

export default Task;
