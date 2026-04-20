import mongoose, { Schema, Model, Types } from 'mongoose';
import type { UpdateQuery } from 'mongoose';
import { Buffer } from 'buffer';

import { parseTaskInput } from '../pipelines/validation.js';

const MAX_INPUT_SIZE = 1e5;

export type TaskType = 'zkTLS' | 'noir' | 'zkVerify';
export type TaskStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'RUNNING'
  | 'DEFERRED'
  | 'COMPLETED'
  | 'FAILED';

interface TaskInterface {
  _id: Types.ObjectId;
  type: TaskType;
  status: TaskStatus;
  queuedAt?: Date;
  attemptStartedAt?: Date;
  deferUntil?: Date;
  deferReason?: string;
  deferCount?: number;
  finishedAt?: Date;
  failedAt?: Date;
  pipelineId: Types.ObjectId;
  input: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
  primus?: unknown;
}

interface CreateTaskBody {
  type: TaskType;
  pipelineId: Types.ObjectId;
  input: Record<string, unknown>;
}

interface CreateTaskOptions {
  session?: mongoose.ClientSession;
}

interface FindTasksByPipelineIdBody {
  pipelineId: Types.ObjectId;
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

  findTasksByPipelineId(body: FindTasksByPipelineIdBody): Promise<TaskInterface[]>;

  markTaskQueued(taskId: string): Promise<void>;

  updateTaskStatus(body: UpdateTaskStatusBody, options?: UpdateTaskStatusOptions): Promise<void>;

  setPrimusCheckpoint(taskId: string, checkpoint: unknown): Promise<void>;
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
  queuedAt: { type: Date },
  attemptStartedAt: { type: Date },
  deferUntil: { type: Date, default: null },
  deferReason: { type: String, default: null },
  deferCount: { type: Number, default: 0 },
  finishedAt: { type: Date },
  failedAt: { type: Date },
  pipelineId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'pipeline',
    index: true,
  },
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
        pipelineId: body.pipelineId,
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

TaskSchema.statics.findTasksByPipelineId = function (
  body: FindTasksByPipelineIdBody,
): ReturnType<TaskModel['findTasksByPipelineId']> {
  return Task.find({ pipelineId: body.pipelineId }).exec();
};

TaskSchema.statics.markTaskQueued = async function (taskId: string) {
  await Task.updateOne({
    _id: taskId,
  }, {
    $set: {
      status: 'QUEUED',
      queuedAt: new Date(),
      attemptStartedAt: null,
      deferUntil: null,
      deferReason: null,
    },
  });
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

  if (body.status !== 'FAILED') {
    $set.failedAt = null;
  }

  if (body.status !== 'DEFERRED') {
    $set.deferUntil = null;
    $set.deferReason = null;
  }

  if (body.status === 'PENDING') {
    $set.queuedAt = null;
    $set.attemptStartedAt = null;
  }

  if (body.status === 'QUEUED') {
    $set.queuedAt = new Date();
    $set.attemptStartedAt = null;
  }

  if (body.status === 'RUNNING') {
    $set.attemptStartedAt = new Date();
    $set.queuedAt = null;
  }

  if (body.status === 'DEFERRED') {
    $set.queuedAt = null;
    $set.attemptStartedAt = null;
    $set.deferUntil = body.deferUntil ?? null;
    $set.deferReason = body.deferReason ?? null;
  }

  if (body.status === 'COMPLETED') {
    $set.finishedAt = new Date();
    $set.result = body.result ?? null;
    $set.error = null;
  }

  if (body.status === 'FAILED') {
    $set.failedAt = new Date();
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

const Task = mongoose.model<TaskInterface, TaskModel>('Task', TaskSchema);

export default Task;
