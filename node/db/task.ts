import mongoose, { Schema, Model, Types } from 'mongoose';
import type { UpdateQuery } from 'mongoose';
import { Buffer } from 'buffer';

const MAX_INPUT_SIZE = 1e5;
const MAX_ATTEMPT_COUNT = 3;

export type TaskType = 'zkTLS' | 'noir' | 'zkVerify';
export type TaskStatus = 'PENDING' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';

interface TaskInterface {
  _id: Types.ObjectId;
  type: TaskType;
  status: TaskStatus;
  queuedAt?: Date;
  attemptStartedAt?: Date;
  finishedAt?: Date;
  failedAt?: Date;
  pipelineId: Types.ObjectId;
  input: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
  attemptCount: number;
  maxAttempt: number;
}

interface CreateTaskBody {
  type: TaskType;
  pipelineId: Types.ObjectId;
  input: Record<string, unknown>;
  maxAttempt?: number;
}

interface FindTasksByPipelineIdBody {
  pipelineId: Types.ObjectId;
}

interface UpdateTaskStatusBody {
  taskId: string;
  status: TaskStatus;
  result?: unknown;
  error?: unknown;
}

interface UpdateTaskStatusOptions {
  session?: mongoose.ClientSession;
}

export interface TaskModel extends Model<TaskInterface> {
  createTask(body: CreateTaskBody): Promise<TaskInterface>;

  findTasksByPipelineId(body: FindTasksByPipelineIdBody): Promise<TaskInterface[]>;

  markTaskQueued(taskId: string): Promise<void>;

  updateTaskStatus(body: UpdateTaskStatusBody, options?: UpdateTaskStatusOptions): Promise<void>;
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
    enum: ['PENDING', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'],
    index: true,
    default: 'PENDING',
  },
  queuedAt: { type: Date },
  attemptStartedAt: { type: Date },
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
  attemptCount: {
    type: Number,
    default: 0,
  },
  maxAttempt: {
    type: Number,
    default: MAX_ATTEMPT_COUNT,
  },
});

TaskSchema.statics.createTask = function (
  body: CreateTaskBody,
): ReturnType<TaskModel['createTask']> {
  return Task.create({
    type: body.type,
    pipelineId: body.pipelineId,
    input: body.input,
    maxAttempt: body.maxAttempt ?? MAX_ATTEMPT_COUNT,
  });
};

TaskSchema.statics.findTasksByPipelineId = function (
  body: FindTasksByPipelineIdBody,
): ReturnType<TaskModel['findTasksByPipelineId']> {
  return Task.find({ pipelineId: body.pipelineId }).exec();
};

TaskSchema.statics.markTaskQueued = async function (taskId: string) {
  await Task.updateOne({ _id: taskId }, { $set: { status: 'QUEUED', queuedAt: new Date() } });
};

TaskSchema.statics.updateTaskStatus = async function (
  body: UpdateTaskStatusBody,
  options?: UpdateTaskStatusOptions,
): Promise<void> {
  const update: UpdateQuery<TaskInterface> = { $set: { status: body.status } };

  if (body.status === 'PENDING') {
    update.$set!.queuedAt = null;
    update.$set!.attemptStartedAt = new Date();
  }

  if (body.status === 'QUEUED') {
    update.$set!.queuedAt = new Date();
  }

  if (body.status === 'RUNNING') {
    update.$set!.attemptStartedAt = new Date();
    update.$inc = { attemptCount: 1 };
  }

  if (body.status === 'COMPLETED') {
    update.$set!.finishedAt = new Date();
    update.$set!.result = body.result ?? null;
    update.$set!.error = null;
  }

  if (body.status === 'FAILED') {
    update.$set!.failedAt = new Date();
  }

  if (body.error !== undefined) {
    update.$set!.error = body.error;
  }

  if (options?.session) {
    await Task.updateOne({ _id: body.taskId }, update, { session: options.session });
    return;
  }

  await Task.updateOne({ _id: body.taskId }, update);
};

const Task = mongoose.model<TaskInterface, TaskModel>('Task', TaskSchema);

export default Task;
