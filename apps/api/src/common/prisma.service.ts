import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Shared Prisma connection, injected wherever a module needs DB access.
// Per CLAUDE.md's cross-module rule: a module injects THIS service and queries
// only its own tables — it does not reach into another module's Prisma models.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
