import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PropertiesModule } from '../properties/properties.module';
import { TenanciesModule } from '../tenancies/tenancies.module';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';

@Module({
  // AuthModule for JwtAuthGuard + UsersService.getPublicProfile();
  // PropertiesModule for UnitsService.getContractDetails(); TenanciesModule
  // for the access-checked tenancy context this module builds contracts
  // from — all through their public interfaces, per CLAUDE.md's
  // cross-module rule. TenanciesModule is a genuine bidirectional
  // dependency (Tenancies' getById() also needs this module's
  // getLatestStatusForTenancy() for the `contract_status` field
  // api-specification.md Section 6 documents) — forwardRef both ways,
  // same pattern as Tenancies<->Payments.
  imports: [AuthModule, PropertiesModule, forwardRef(() => TenanciesModule)],
  controllers: [ContractsController],
  providers: [ContractsService],
  exports: [ContractsService],
})
export class ContractsModule {}
