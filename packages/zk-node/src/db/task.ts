import mongoose, { Schema, type Types } from 'mongoose';
import { Buffer } from 'buffer';

const MAX_INPUT_SIZE = 1e5;

export type TaskType = 'zkTLS' | 'noir' | 'zkVerify';
export type TaskStatus = 'PENDING' | 'QUEUED' | 'RUNNING' | 'DEFERRED' | 'COMPLETED' | 'FAILED';

export interface TaskInterface {
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

const TaskSchema = new Schema<TaskInterface>({
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

export const Task =
  (mongoose.models.Task as mongoose.Model<TaskInterface> | undefined) ??
  mongoose.model<TaskInterface>('Task', TaskSchema);
