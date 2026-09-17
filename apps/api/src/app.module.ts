import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { PrismaModule } from './common/prisma.module';
import { StorageModule } from './common/storage/storage.module';
import { AuthModule } from './modules/auth/auth.module';
import { PropertiesModule } from './modules/properties/properties.module';
import { VisitsModule } from './modules/visits/visits.module';
import { TenanciesModule } from './modules/tenancies/tenancies.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ContractsModule } from './modules/contracts/contracts.module';

// Remaining feature modules (notifications, complaints, admin) get
// imported here as they're built, following the order in CLAUDE.md.

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(), // backs the internal cross-module event bus
    ScheduleModule.forRoot(), // backs @Cron() — Tenancies'/Payments' in-process sweeps
    PrismaModule,
    StorageModule,
    AuthModule,
    PropertiesModule,
    VisitsModule,
    TenanciesModule,
    PaymentsModule,
    ContractsModule,
    // NotificationsModule, ComplaintsModule, AdminModule — add here
  ],
  controllers: [AppController],
})
export class AppModule {}
