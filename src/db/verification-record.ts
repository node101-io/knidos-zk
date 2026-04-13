import { createHash } from 'node:crypto';
import mongoose, { Schema, Types } from 'mongoose';
import type { VerifyTransactionInfo } from 'zkverifyjs';

import {
  SUPPORTED_BINANCE_SYMBOLS,
  type SupportedBinanceSymbol,
} from '../shared/binance-symbols.js';

export interface VerificationRecordInterface {
  pipelineId: Types.ObjectId;
  zkVerifyTaskId: Types.ObjectId;
  noirTaskId: Types.ObjectId;
  symbol: SupportedBinanceSymbol;
  startTime: Date;
  endTime: Date;

  // zkVerify outputs
  statement: string;
  aggregationId: number;
  includedInBlock: VerifyTransactionInfo;

  variant: string;

  // proof artifacts
  vk: string;
  vkHash: string;
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
    symbol: {
      type: String,
      required: true,
      enum: SUPPORTED_BINANCE_SYMBOLS,
      index: true,
    },
    startTime: {
      type: Date,
      required: true,
      index: true,
    },
    endTime: {
      type: Date,
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
    vkHash: {
      type: String,
      index: true,
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

VerificationRecordSchema.pre('save', function () {
  if (this.isModified('vk') || !this.vkHash) {
    this.vkHash = createHash('sha256').update(this.vk).digest('hex');
  }
});

const VerificationRecord = mongoose.model<VerificationRecordInterface>(
  'VerificationRecord',
  VerificationRecordSchema,
);

export default VerificationRecord;
