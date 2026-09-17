import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PropertiesModule } from '../properties/properties.module';
import { PaymentsModule } from '../payments/payments.module';
import { ContractsModule } from '../contracts/contracts.module';
import { TenanciesController } from './tenancies.controller';
import { TenanciesService } from './tenancies.service';

@Module({
  // AuthModule for JwtAuthGuard + UsersService.exists(); PropertiesModule
  // for UnitsService.getUnitOwnership() (validates unit exists, is vacant,
  // and belongs to this landlord) — both through their public interfaces,
  // per CLAUDE.md's cross-module rule. Properties' own UnitOccupancyListener
  // (not this module) is what actually flips unit status on our events.
  // PaymentsModule and ContractsModule are both genuine bidirectional
  // dependencies (see the forwardRef comments in tenancies.service.ts) —
  // imported both ways with forwardRef.
  imports: [AuthModule, PropertiesModule, forwardRef(() => PaymentsModule), forwardRef(() => ContractsModule)],
  controllers: [TenanciesController],
  providers: [TenanciesService],
  exports: [TenanciesService],
})
export class TenanciesModule {}
