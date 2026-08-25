import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { PrismaModule } from './common/prisma.module';
import { AuthModule } from './modules/auth/auth.module';

// Remaining feature modules (properties, visits, tenancies, payments,
// contracts, notifications, complaints, admin) get imported here as they're
// built, following the order in CLAUDE.md.

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(), // backs the internal cross-module event bus
    PrismaModule,
    AuthModule,
    // PropertiesModule, VisitsModule, TenanciesModule, PaymentsModule,
    // ContractsModule, NotificationsModule, ComplaintsModule, AdminModule — add here
  ],
  controllers: [AppController],
})
export class AppModule {}
