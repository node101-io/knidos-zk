import mongoose, { Schema, Model, Types } from 'mongoose';
import type { UpdateQuery } from 'mongoose';
import { Buffer } from 'buffer';

const MAX_INPUT_SIZE = 1e5;
const MAX_ATTEMPT_COUNT = 3;

export type TaskType = 'zkTLS' | 'noir' | 'zkVerify';
export type TaskStatus = 'PENDING' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface TaskInterface {
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

export interface TaskModel extends Model<TaskInterface> {
  createTask(body: {
    type: TaskType;
    pipelineId: Types.ObjectId;
    input: Record<string, unknown>;
    maxAttempt?: number;
  }): Promise<TaskInterface>;

  findTasksByPipelineId(body: { pipelineId: Types.ObjectId }): Promise<TaskInterface[]>;

  updateTaskStatus(
    body: {
      taskId: string;
      status: TaskStatus;
      result?: unknown;
      error?: unknown;
    },
    options?: { session?: mongoose.ClientSession },
  ): Promise<void>;
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

TaskSchema.statics.createTask = function (body) {
  const { type, pipelineId, input, maxAttempt } = body;
  return this.create({
    type,
    pipelineId,
    input,
    maxAttempt: maxAttempt ?? MAX_ATTEMPT_COUNT,
  });
};

TaskSchema.statics.findTasksByPipelineId = function (body) {
  return this.find({ pipelineId: body.pipelineId });
};

TaskSchema.statics.updateTaskStatus = async function (body, options) {
  const { taskId, status, result, error } = body;

  const update: UpdateQuery<TaskInterface> = { $set: { status } };

  if (status === 'PENDING') {
    update.$set!.queuedAt = null;
    update.$set!.attemptStartedAt = new Date();
  }

  if (status === 'QUEUED') {
    update.$set!.queuedAt = new Date();
  }

  if (status === 'RUNNING') {
    update.$set!.attemptStartedAt = new Date();
    update.$inc = { attemptCount: 1 };
  }

  if (status === 'COMPLETED') {
    update.$set!.finishedAt = new Date();
    update.$set!.result = result ?? null;
    update.$set!.error = null;
  }

  if (status === 'FAILED') {
    update.$set!.failedAt = new Date();
  }

  if (error !== undefined) {
    update.$set!.error = error;
  }

  await this.updateOne({ _id: taskId }, update, { session: options?.session });
};

const Task = mongoose.model<TaskInterface, TaskModel>('Task', TaskSchema);

export default Task;
