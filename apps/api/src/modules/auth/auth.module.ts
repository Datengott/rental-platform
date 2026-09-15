import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { UsersController } from './users.controller';
import { AdminKycController } from './admin-kyc.controller';
import { AuthService } from './auth.service';
import { UsersService } from './users.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { ConsoleSmsGateway, SMS_GATEWAY } from './sms/sms-gateway';

@Module({
  imports: [JwtModule.register({})], // secret/expiry passed explicitly per sign/verify call
  controllers: [AuthController, UsersController, AdminKycController],
  providers: [
    AuthService,
    UsersService,
    JwtAuthGuard,
    RolesGuard,
    { provide: SMS_GATEWAY, useClass: ConsoleSmsGateway },
  ],
  // Other modules need these to guard their own routes and to call Auth's
  // public interface (e.g. Properties granting the landlord role) — per
  // CLAUDE.md, through this service, never through Auth's Prisma models.
  exports: [JwtModule, JwtAuthGuard, RolesGuard, UsersService],
})
export class AuthModule {}
