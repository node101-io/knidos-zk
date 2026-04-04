import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

export async function connectMongoDB(): Promise<void> {
  const mongoUri =
    process.env.MONGO_URI ||
    "mongodb://127.0.0.1:27017/node101-knidos-zk-trade?replicaSet=rs0";

  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });

    console.log("MongoDB connected");
  } catch (err: any) {
    if (err?.name === "MongooseServerSelectionError") {
      console.error("database_connection_error");
    } else {
      console.error("database_error:", err);
    }
    throw err;
  }
}