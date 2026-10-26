import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { seedDatabase } from '../src/utils/seed-database.js';

export async function startTestDatabase() {
  const server = await MongoMemoryServer.create();
  try {
    await mongoose.connect(server.getUri('task_manager_test'));
    await seedDatabase();
  } catch (error) {
    await mongoose.disconnect();
    await server.stop();
    throw error;
  }

  return {
    async stop() {
      await mongoose.disconnect();
      await server.stop();
    },
  };
}
