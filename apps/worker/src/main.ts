import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import cron from 'node-cron';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

async function verifyConnections() {
  await prisma.$queryRaw`SELECT 1`;
  await redis.ping();
  console.log('[worker] Database and Redis connections verified.');
}

// Placeholder for the daily rent-expiry reminder scan described in
// docs/deployment-infrastructure-and-module-schemas.md Section B.7.
// Real implementation lands once the tenancies + notifications modules exist —
// this just proves the worker container runs on a schedule correctly.
cron.schedule('0 7 * * *', async () => {
  console.log('[worker] rent_expiry_reminder_scan would run now (not yet implemented).');
});

async function main() {
  await verifyConnections();
  console.log('[worker] Started. Waiting for scheduled jobs...');
}

main().catch((err) => {
  console.error('[worker] Failed to start:', err);
  process.exit(1);
});
