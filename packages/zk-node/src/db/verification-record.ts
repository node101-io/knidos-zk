import mongoose, { Schema, type Types } from 'mongoose';

import { SUPPORTED_BINANCE_SYMBOLS, type SupportedBinanceSymbol } from '../shared/binance-symbols.js';

export interface VerificationRecordInterface {
  zkVerifyTaskId: Types.ObjectId;
  noirTaskId: Types.ObjectId;
  symbol: SupportedBinanceSymbol;
  startTime: Date;
  endTime: Date;

  variant: string;

  vkHash: string;
  publicSignals: string[];

  txHash?: string;

  createdAt: Date;
  updatedAt: Date;
}

const VerificationRecordSchema = new Schema<VerificationRecordInterface>(
  {
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

    variant: {
      type: String,
      required: true,
    },

    vkHash: {
      type: String,
      required: true,
      index: true,
    },
    publicSignals: {
      type: [String],
      required: true,
      default: [],
    },

    txHash: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

export const VerificationRecord =
  (mongoose.models.VerificationRecord as mongoose.Model<VerificationRecordInterface> | undefined) ??
  mongoose.model<VerificationRecordInterface>('VerificationRecord', VerificationRecordSchema);
