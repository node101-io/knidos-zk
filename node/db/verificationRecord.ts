import mongoose, { Schema, Types } from 'mongoose';
import type { VerifyTransactionInfo } from 'zkverifyjs';

export interface VerificationRecordInterface {
  pipelineId: Types.ObjectId;
  zkVerifyTaskId: Types.ObjectId;
  noirTaskId: Types.ObjectId;

  // zkVerify outputs
  statement?: string;
  aggregationId?: number;
  includedInBlock?: VerifyTransactionInfo;

  variant: string;

  // proof artifacts
  vk: string;
  proof: string;
  publicSignals: string[];

  createdAt: Date;
  updatedAt: Date;
}

const VerificationRecordSchema = new Schema<VerificationRecordInterface>(
  {
    pipelineId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    zkVerifyTaskId: {
      type: Schema.Types.ObjectId,
      required: true,
      unique: true,
    },
    noirTaskId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    statement: { type: String },
    aggregationId: { type: Number },
    includedInBlock: { type: Schema.Types.Mixed },

    variant: {
      type: String,
      required: true,
    },

    vk: {
      type: String,
      required: true,
    },
    proof: {
      type: String,
      required: true,
    },
    publicSignals: {
      type: [String],
      required: true,
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

const VerificationRecord = mongoose.model<VerificationRecordInterface>(
  'VerificationRecord',
  VerificationRecordSchema,
);

export default VerificationRecord;
