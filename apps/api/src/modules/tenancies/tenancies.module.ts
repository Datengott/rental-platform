import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PropertiesModule } from '../properties/properties.module';
import { TenanciesController } from './tenancies.controller';
import { TenanciesService } from './tenancies.service';

@Module({
  // AuthModule for JwtAuthGuard + UsersService.exists(); PropertiesModule
  // for UnitsService.getUnitOwnership() (validates unit exists, is vacant,
  // and belongs to this landlord) — both through their public interfaces,
  // per CLAUDE.md's cross-module rule. Properties' own UnitOccupancyListener
  // (not this module) is what actually flips unit status on our events.
  imports: [AuthModule, PropertiesModule],
  controllers: [TenanciesController],
  providers: [TenanciesService],
})
export class TenanciesModule {}
