// Prisma Client Singleton
// Prevents multiple instances in development with hot reloading

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;

// Configure Prisma with connection handling for Supabase
const prismaClientOptions = {
  log: process.env.NODE_ENV === 'development' 
    ? ['query', 'error', 'warn'] 
    : ['error'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient(prismaClientOptions);

// Handle connection errors gracefully
prisma.$connect()
  .then(() => {
    console.log('✅ Database connected successfully');
  })
  .catch((err) => {
    console.error('❌ Database connection failed:', err.message);
    console.error('DATABASE_URL format check:', process.env.DATABASE_URL ? 'Set (length: ' + process.env.DATABASE_URL.length + ')' : 'NOT SET');
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
