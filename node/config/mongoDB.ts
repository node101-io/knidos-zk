import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

export async function connectMongoDB(): Promise<void> {
  const mongoUri =
    process.env.MONGO_URI ||
    "mongodb://127.0.0.1:27017/node101-knidos-zk-trade";

  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });

    console.log("MongoDB connected");
  } catch (err: any) {
    console.error("MongoDB connection error:", err);

    throw err;
  }
}
