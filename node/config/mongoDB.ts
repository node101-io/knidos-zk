import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import path from 'path';

const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/node101-knidos-zk-trade';

await mongoose
  .connect(mongoUri)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));