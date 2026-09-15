import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PropertiesModule } from '../properties/properties.module';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';

@Module({
  // AuthModule for JwtAuthGuard; PropertiesModule for UnitsService's
  // getUnitOwnership() — both through their public interfaces, per
  // CLAUDE.md's cross-module rule.
  imports: [AuthModule, PropertiesModule],
  controllers: [VisitsController],
  providers: [VisitsService],
})
export class VisitsModule {}
