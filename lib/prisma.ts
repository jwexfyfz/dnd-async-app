import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("❌ CRITICAL ERR: DATABASE_URL environment variable is missing!");
}

// FIX: Prisma 7 standard requires passing options directly to the 
// adapter instance, entirely bypassing the broken 'Pool' abstraction layer.
const prismaAdapter = new PrismaNeon({ connectionString });

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ?? 
  new PrismaClient({ 
    adapter: prismaAdapter
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
