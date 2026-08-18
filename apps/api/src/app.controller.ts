import { Controller, Get, Injectable } from '@nestjs/common';
import { PrismaService } from './common/prisma.service';
import Redis from 'ioredis';

@Injectable()
class RedisHealthClient {
  private client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  async ping() {
    return this.client.ping();
  }
}

@Controller()
export class AppController {
  private redis = new RedisHealthClient();

  constructor(private prisma: PrismaService) {}

  // GET /health — deliberately checks real dependencies, not just "the process is up".
  // If this returns 200 with both checks "ok", docker-compose's Postgres, Redis, and
  // the api container's env vars/networking are all genuinely wired correctly —
  // the thing worth confirming before Claude Code starts building real modules on top.
  @Get('health')
  async health() {
    const result: Record<string, string> = { status: 'ok' };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      result.database = 'ok';
    } catch (err) {
      result.database = 'unreachable';
      result.status = 'degraded';
    }

    try {
      await this.redis.ping();
      result.redis = 'ok';
    } catch (err) {
      result.redis = 'unreachable';
      result.status = 'degraded';
    }

    return result;
  }
}
