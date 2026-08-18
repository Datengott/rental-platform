import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { PrismaService } from './common/prisma.service';

// Feature modules (auth, properties, visits, tenancies, payments, contracts,
// notifications, complaints, admin) get imported here as they're built —
// following the order in CLAUDE.md. Empty for now; this is the health-check
// skeleton that proves the container/DB/Redis wiring works.

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(), // backs the internal cross-module event bus
    // AuthModule, PropertiesModule, VisitsModule, TenanciesModule, PaymentsModule,
    // ContractsModule, NotificationsModule, ComplaintsModule, AdminModule — add here
  ],
  controllers: [AppController],
  providers: [PrismaService],
})
export class AppModule {}
