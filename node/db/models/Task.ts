import mongoose, { Schema, Model, Types } from "mongoose";
import { Buffer } from "buffer";

const MAX_INPUT_SIZE = 1e5;
const MAX_ATTEMPT_COUNT = 3;

export interface TaskInterface {
  _id: Types.ObjectId;

  type: "zkTLS" | "noir" | "zkVerify";
  status: "PENDING" | "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
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
  createTask: (
    body: {
      type: "zkTLS" | "noir" | "zkVerify";
      pipelineId: Types.ObjectId;
      input: Record<string, unknown>;
      maxAttempt?: number;
    },
    callback: (
      err: string | null,
      task: TaskInterface | null
    ) => any
  ) => any;

  findTasksByPipelineId: (
    body: { pipelineId: Types.ObjectId },
    callback: (
      err: string | null,
      tasks: TaskInterface[] | null
    ) => any
  ) => any;
  updateTaskStatus: (
      body: {
        taskId: string;
        status: "PENDING" | "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
        result?: unknown;
        error?: unknown;
      },
      options?: { session?: mongoose.ClientSession }
    ) => any;
}

const TaskSchema = new Schema<TaskInterface>({
  type: {
    type: String,
    required: true,
    enum: ["zkTLS", "noir", "zkVerify"],
    index: true
  },
  status: {
    type: String,
    required: true,
    enum: ["PENDING", "QUEUED", "RUNNING", "COMPLETED", "FAILED"],
    index: true,
    default: "PENDING"
  },
  queuedAt: {
    type: Date
  },
  attemptStartedAt: {
    type: Date
  },
  finishedAt: {
    type: Date
  },
  failedAt: {
    type: Date
  },
  pipelineId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: "pipeline",
    index: true
  },
  input: {
    type: Schema.Types.Mixed,
    required: true,
    validate: {
    validator: function (value: unknown) {
      const size = Buffer.byteLength(JSON.stringify(value), "utf8");
      return size <= MAX_INPUT_SIZE;
    },
    message: "bad_request"
  }
  },
  result: {
    type: Schema.Types.Mixed,
    default: null
  },
  error: {
    type: Schema.Types.Mixed,
    default: null
  },
  attemptCount: {
    type: Number,
    default: 0
  },
  maxAttempt: {
    type: Number,
    default: MAX_ATTEMPT_COUNT
  }
});

TaskSchema.statics.createTask = function ( body: Parameters<TaskModel["createTask"]>[0], callback: Parameters<TaskModel["createTask"]>[1]) {
  const { type, pipelineId, input, maxAttempt } = body;

  this.create({
    type,
    pipelineId,
    input,
    maxAttempt: maxAttempt ?? 3
  })
    .then((task: TaskInterface) => callback(null, task))
    .catch(() => callback("bad_request", null));
};

TaskSchema.statics.findTasksByPipelineId = function (body: Parameters<TaskModel["findTasksByPipelineId"]>[0], callback: Parameters<TaskModel["findTasksByPipelineId"]>[1]) {
  const { pipelineId } = body;

  this.find({ pipelineId })
    .then((tasks: TaskInterface[]) => callback(null, tasks))
    .catch(() => callback("bad_request", null));
};

TaskSchema.statics.updateTaskStatus = async function ( //TODO: ask necip
  body: Parameters<TaskModel["updateTaskStatus"]>[0],
  options?: Parameters<TaskModel["updateTaskStatus"]>[1]
) {
  const { taskId, status, result, error } = body;

  const update: Record<string, any> = {
    $set: { status },
  };
  if (status === "PENDING") {
    update.$set.queuedAt = null;
    update.$set.attemptStartedAt=null;
  }

  if (status === "QUEUED") {
    update.$set.queuedAt = new Date();
  }

  if (status === "RUNNING") {
    update.$set.attemptStartedAt = new Date();
    update.$inc = { attemptCount: 1 }; //burada increment kullanmam lazım, eğer bir sıkıntı olursa db bunu yapamazsa falan sıkıntı çıkıyor mu?
  }

  if (status === "COMPLETED") {
    update.$set.finishedAt = new Date();
    update.$set.result = result ?? null;
    update.$set.error = null;
  }

  if (status === "FAILED") {
    update.$set.failedAt = new Date();
  }

  if (error !== undefined) {
    update.$set.error = error;
  }

  return this.updateOne(
    { _id: taskId },
    update,
    ...(options?.session ? [{ session: options.session }] : [])
  );
};

const Task = (mongoose.models.Task as TaskModel) || mongoose.model<TaskInterface, TaskModel>("Task", TaskSchema);

export default Task;