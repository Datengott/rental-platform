import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PropertiesController } from './properties.controller';
import { UnitsController } from './units.controller';
import { PropertiesService } from './properties.service';
import { UnitsService } from './units.service';
import { UnitOccupancyListener } from './unit-occupancy.listener';

@Module({
  // AuthModule for JwtAuthGuard (route protection) and UsersService
  // (granting the landlord role) — through its public interface, per
  // CLAUDE.md's cross-module rule.
  imports: [AuthModule],
  controllers: [PropertiesController, UnitsController],
  providers: [PropertiesService, UnitsService, UnitOccupancyListener],
  // Visits needs UnitsService.getUnitOwnership() to denormalize landlord_id
  // onto a visit request — through this public interface, never Properties'
  // Prisma models directly.
  exports: [UnitsService],
})
export class PropertiesModule {}
