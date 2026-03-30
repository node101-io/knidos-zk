import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

export async function connectMongoDB(): Promise<void> {
  const mongoUri =
    process.env.MONGO_URI ||
    'mongodb://127.0.0.1:27017/node101-knidos-zk-trade?replicaSet=rs0';

  try {
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1); // stop app if DB fails
  }
}