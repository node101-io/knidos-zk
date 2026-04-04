import mongoose, { Schema, Model, Types } from "mongoose";

const MAX_INPUT_SIZE = 1e5;

export interface TaskInterface {
  _id: Types.ObjectId;

  type: "zkTLS" | "noir" | "zkVerify";
  status: "PENDING" | "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  queuedAt?: Date;
  startedAt?: Date;
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
  updateTaskStatus2: (
      body: {
        taskId: string;
        status: "PENDING" | "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
        result?: unknown;
        error?: unknown;
      },
      options?: { session?: mongoose.ClientSession }
    ) => any;
  updateTaskStatus: (
    body: {
      taskId: string;
      status: "PENDING" | "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
      result?: unknown;
      error?: unknown;
    },
    callback: (
      err: string | null,
      task: TaskInterface | null
    ) => any
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
  startedAt: {
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
    default: 3
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
TaskSchema.statics.updateTaskStatus2 = async function (body: Parameters<TaskModel["updateTaskStatus2"]>[0], options?: Parameters<TaskModel["updateTaskStatus2"]>[1]) {
  const { taskId, status, result, error } = body;

  const update: Record<string, unknown> = { status };

  if (update.status === "QUEUED") update.queuedAt = new Date();
  if (update.status === "RUNNING") update.startedAt = new Date();
  if (update.status === "COMPLETED") {
    update.finishedAt = new Date();
    update.result = update.result ?? null;
    update.error = null;
  }
  if (update.status === "FAILED") {
    update.failedAt = new Date();
    update.error = update.error ?? null;
  }

  return this.updateOne(
    { _id: taskId },
    update,
    { session: options?.session }
  );
};
TaskSchema.statics.updateTaskStatus = function (body: Parameters<TaskModel["updateTaskStatus"]>[0], callback: Parameters<TaskModel["updateTaskStatus"]>[1]) {
  const { taskId, status, result, error } = body;

  const update: Record<string, unknown> = { status };

  if (status === "QUEUED") update.queuedAt = new Date();
  if (status === "RUNNING") update.startedAt = new Date(); //TODO
  if (status === "COMPLETED") {
    update.finishedAt = new Date();
    update.result = result ?? null;
  }
  if (status === "FAILED") {
    update.failedAt = new Date();
    update.error = error ?? null;
  }

  this.findByIdAndUpdate(taskId, update, { new: true })
    .then((task: TaskInterface | null) => {
      if (!task) return callback("document_not_found", null);
      return callback(null, task);
    })
    .catch(() => callback("bad_request", null));
};

const Task = (mongoose.models.Task as TaskModel) || mongoose.model<TaskInterface, TaskModel>("Task", TaskSchema);

export default Task;