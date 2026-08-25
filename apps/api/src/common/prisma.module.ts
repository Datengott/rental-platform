import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Global so every feature module can inject PrismaService without each one
// re-providing it (which would create a separate connection per module).
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
