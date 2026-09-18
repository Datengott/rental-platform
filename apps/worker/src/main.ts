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

// The rent-expiry reminder scan described in
// docs/deployment-infrastructure-and-module-schemas.md Section B.7 ended up
// living in apps/api instead (NotificationsService, @nestjs/schedule) —
// see README.md's tech-stack table — so it shares the api's own in-process
// event bus rather than needing cross-process plumbing. Nothing runs here
// for it; this comment is just the pointer for anyone looking for it.

// Visits module (Section B.3) — PRD Epic 3 US-3.1 AC2: a pending visit
// request auto-expires 48h after creation. The api's VisitsService also
// lazy-expires on the single-record path it touches (respond()), so
// correctness never depends on this sweep's interval — this just catches
// requests nobody ever acted on.
//
// "the tenant is notified" (same AC) still isn't implemented, even though
// the Notifications module now exists: this process has no event bus
// shared with the api (EventEmitter2 is in-process only). Wiring this up
// would need an outbox table or Redis pub/sub publishing
// visit_request.expired for each row — not a direct HTTP call back into
// the api — and hasn't been built. See README.md's Visits entry.
cron.schedule('*/15 * * * *', async () => {
  const { count } = await prisma.visitRequest.updateMany({
    where: { status: 'pending', expiresAt: { lt: new Date() } },
    data: { status: 'expired' },
  });
  if (count > 0) {
    console.log(`[worker] visit_request_expiry_sweep: expired ${count} request(s).`);
  }
});

async function main() {
  await verifyConnections();
  console.log('[worker] Started. Waiting for scheduled jobs...');
}

main().catch((err) => {
  console.error('[worker] Failed to start:', err);
  process.exit(1);
});
