import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VisitRequestStatus } from '@prisma/client';
import { ApiException } from '../../common/exceptions/api.exception';
import {
  VISIT_REQUEST_CREATED,
  VISIT_REQUEST_RESPONDED,
  VisitRequestCreatedEvent,
  VisitRequestRespondedEvent,
} from '../../common/events/visit-request.events';
import { PrismaService } from '../../common/prisma.service';
import { UnitsService } from '../properties/units.service';
import { CreateVisitRequestDto } from './dto/create-visit-request.dto';
import { RespondVisitRequestDto } from './dto/respond-visit-request.dto';
import { ListVisitRequestsDto } from './dto/list-visit-requests.dto';

// Not in .env.example — api-specification.md Section 5 gives this as a
// literal example ("+48h"), and PRD Epic 3 US-3.1 AC2 states it as the
// product requirement directly, so it's a constant here rather than config.
const VISIT_REQUEST_TTL_HOURS = 48;

@Injectable()
export class VisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly units: UnitsService,
    private readonly events: EventEmitter2,
  ) {}

  async createVisitRequest(tenantId: string, unitId: string, dto: CreateVisitRequestDto) {
    const unit = await this.units.getUnitOwnership(unitId);

    const visitRequest = await this.prisma.visitRequest.create({
      data: {
        unitId,
        tenantId,
        landlordId: unit.landlordId,
        // Prisma's Json input wants plain objects, not class instances —
        // map off the DTO class shape.
        requestedSlots: dto.requested_slots.map((slot) => ({ start: slot.start })),
        expiresAt: new Date(Date.now() + VISIT_REQUEST_TTL_HOURS * 60 * 60 * 1000),
      },
    });

    this.events.emit(VISIT_REQUEST_CREATED, {
      visitRequestId: visitRequest.id,
      unitId,
      tenantId,
      landlordId: unit.landlordId,
    } satisfies VisitRequestCreatedEvent);

    return this.toResponse(visitRequest);
  }

  async respond(landlordId: string, visitRequestId: string, dto: RespondVisitRequestDto) {
    await this.getRespondableRequest(landlordId, visitRequestId);

    const data =
      dto.action === 'accept'
        ? { status: VisitRequestStatus.accepted, confirmedSlot: new Date(dto.confirmed_slot!) }
        : dto.action === 'decline'
          ? { status: VisitRequestStatus.declined }
          : // 'reschedule': the DDL has one confirmedSlot column, not a separate
            // "landlord's counter-proposal" field, and the API spec has no
            // follow-up endpoint for the tenant to respond to it — so the
            // proposed time is stored here too, distinguished by status
            // ('rescheduled' vs 'accepted'). A tenant who wants that new
            // time currently has to submit a fresh visit request.
            { status: VisitRequestStatus.rescheduled, confirmedSlot: new Date(dto.proposed_slot!) };

    const updated = await this.prisma.visitRequest.update({
      where: { id: visitRequestId },
      data: { ...data, landlordNote: dto.landlord_note },
    });

    this.events.emit(VISIT_REQUEST_RESPONDED, {
      visitRequestId,
      action: dto.action,
      status: updated.status,
      tenantId: updated.tenantId,
      landlordId,
    } satisfies VisitRequestRespondedEvent);

    return this.toResponse(updated);
  }

  async listForLandlord(landlordId: string, query: ListVisitRequestsDto) {
    const limit = query.limit ?? 20;

    const requests = await this.prisma.visitRequest.findMany({
      where: { landlordId, status: query.status },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = requests.length > limit;
    const page = hasMore ? requests.slice(0, limit) : requests;

    return {
      results: page.map((r) => this.toResponse(r)),
      next_cursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  // Lazy expiry on the single-record path used by respond() — the worker's
  // periodic sweep (apps/worker) handles the bulk case, but a request can
  // legitimately go past expires_at in the gap between sweeps, and a
  // landlord must never be able to accept/decline/reschedule a request
  // that's actually expired just because the sweep hasn't run yet.
  private async getRespondableRequest(landlordId: string, visitRequestId: string) {
    const visitRequest = await this.prisma.visitRequest.findUnique({ where: { id: visitRequestId } });
    if (!visitRequest || visitRequest.landlordId !== landlordId) {
      throw new NotFoundException('Visit request not found');
    }

    if (visitRequest.status === VisitRequestStatus.pending && visitRequest.expiresAt < new Date()) {
      await this.prisma.visitRequest.update({
        where: { id: visitRequestId },
        data: { status: VisitRequestStatus.expired },
      });
      throw new ApiException(
        'VISIT_REQUEST_NOT_RESPONDABLE',
        'This visit request has expired.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    if (visitRequest.status !== VisitRequestStatus.pending) {
      throw new ApiException(
        'VISIT_REQUEST_NOT_RESPONDABLE',
        `This visit request is already "${visitRequest.status}" and can no longer be responded to.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    return visitRequest;
  }

  private toResponse(visitRequest: {
    id: string;
    unitId: string;
    tenantId: string;
    landlordId: string;
    requestedSlots: unknown;
    status: string;
    confirmedSlot: Date | null;
    landlordNote: string | null;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: visitRequest.id,
      unit_id: visitRequest.unitId,
      tenant_id: visitRequest.tenantId,
      landlord_id: visitRequest.landlordId,
      requested_slots: visitRequest.requestedSlots,
      status: visitRequest.status,
      confirmed_slot: visitRequest.confirmedSlot,
      landlord_note: visitRequest.landlordNote,
      expires_at: visitRequest.expiresAt,
      created_at: visitRequest.createdAt,
      updated_at: visitRequest.updatedAt,
    };
  }
}
