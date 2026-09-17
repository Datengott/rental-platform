import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { UnitStatus } from '@prisma/client';
import {
  TENANCY_CREATED,
  TENANCY_TERMINATED,
  TenancyCreatedEvent,
  TenancyTerminatedEvent,
} from '../../common/events/tenancy.events';
import { UnitsService } from './units.service';

// Properties reacting to Tenancies' events (documented in schema doc
// Section B.2: "tenancy.created -> set unit status to occupied,
// tenancy.terminated -> set unit status to vacant") — this is Properties'
// own code, not a cross-module Prisma write.
@Injectable()
export class UnitOccupancyListener {
  private readonly logger = new Logger(UnitOccupancyListener.name);

  constructor(private readonly units: UnitsService) {}

  @OnEvent(TENANCY_CREATED)
  async handleTenancyCreated(event: TenancyCreatedEvent) {
    const unit = await this.units.getUnitOwnership(event.unitId);
    await this.units.transitionStatus(event.unitId, unit.status, UnitStatus.occupied);
    this.logger.log(`Unit ${event.unitId} -> occupied (tenancy ${event.tenancyId})`);
  }

  @OnEvent(TENANCY_TERMINATED)
  async handleTenancyTerminated(event: TenancyTerminatedEvent) {
    const unit = await this.units.getUnitOwnership(event.unitId);
    await this.units.transitionStatus(event.unitId, unit.status, UnitStatus.vacant);
    this.logger.log(`Unit ${event.unitId} -> vacant (tenancy ${event.tenancyId} terminated)`);
  }
}
