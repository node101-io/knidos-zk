import { Schema, model, Types } from "mongoose";
const MAX_INPUT_SIZE = 1e4;
const TaskSchema = new Schema ({
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
  queuedAt: Date,
  startedAt: Date,
  finishedAt: Date,
  failedAt: Date,
  pipelineId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: "pipeline",
    index: true
  },
  input: {
    type: Schema.Types.Mixed,
    required: true, // All tasks require input
    trim: true,
    maxlength: MAX_INPUT_SIZE,
    default: null
  },
  result: {
    type: Schema.Types.Mixed,
    trim: true,
    maxlength: MAX_INPUT_SIZE,
    default: null
  },
  error: {
    type: Schema.Types.Mixed,
    trim: true,
    default: null,

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