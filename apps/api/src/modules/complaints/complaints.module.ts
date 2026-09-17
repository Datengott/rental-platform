import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenanciesModule } from '../tenancies/tenancies.module';
import { ComplaintsController } from './complaints.controller';
import { ComplaintsService } from './complaints.service';

@Module({
  // AuthModule for JwtAuthGuard; TenanciesModule for
  // TenanciesService.getPartiesForTenancy() (validates the requester is
  // this tenancy's actual tenant, and denormalizes unitId/landlordId onto
  // the complaint) — through its public interface, per CLAUDE.md's
  // cross-module rule. One-way only: Tenancies needs nothing back, so no
  // forwardRef here.
  imports: [AuthModule, TenanciesModule],
  controllers: [ComplaintsController],
  providers: [ComplaintsService],
  exports: [ComplaintsService],
})
export class ComplaintsModule {}
