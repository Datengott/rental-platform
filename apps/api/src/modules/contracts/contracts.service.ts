import { randomUUID } from 'node:crypto';
import { forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../common/prisma.service';
import { OBJECT_STORAGE, ObjectStorage } from '../../common/storage/object-storage';
import { CONTRACT_GENERATED, ContractGeneratedEvent } from '../../common/events/contract.events';
import { TenanciesService } from '../tenancies/tenancies.service';
import { UnitsService } from '../properties/units.service';
import { UsersService } from '../auth/users.service';
import { GenerateContractDto } from './dto/generate-contract.dto';
import { generateContractDocument } from './contract-document';

const TEMPLATE_VERSION = 'v1';

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    @Inject(OBJECT_STORAGE) private readonly objectStorage: ObjectStorage,
    // forwardRef: Tenancies' getById() needs getLatestStatusForTenancy()
    // from us (see the comment on that method) — a genuine bidirectional
    // read between two closely-related bounded contexts, same pattern as
    // Tenancies<->Payments. Both the module-level import (contracts.module.ts)
    // and this constructor parameter need forwardRef, not just one.
    @Inject(forwardRef(() => TenanciesService)) private readonly tenanciesService: TenanciesService,
    private readonly unitsService: UnitsService,
    private readonly usersService: UsersService,
  ) {}

  // Epic 6 AC2/AC3 (OTP-verified e-signature, audit trail, re-access once
  // signed) are deliberately NOT built — the user chose to defer the whole
  // signature flow (2026-09-17, see CLAUDE.md's Resolved decisions) pending
  // the "basic vs. advanced e-signature tier" legal question, which stays
  // flagged. This method only covers AC1: generating the document itself.
  // A contract created here has no path to `pending_signatures`/
  // `fully_signed` yet — it stays `draft`.
  async generateContract(requesterId: string, tenancyId: string, dto: GenerateContractDto) {
    const tenancy = await this.tenanciesService.getContractContext(requesterId, tenancyId);
    const [landlord, tenant, unit] = await Promise.all([
      this.usersService.getPublicProfile(tenancy.landlord_id),
      this.usersService.getPublicProfile(tenancy.tenant_id),
      this.unitsService.getContractDetails(tenancy.unit_id),
    ]);

    // requesterId is always one of the two, per getContractContext's own
    // access check — used only to pick the right default locale.
    const requesterProfile = requesterId === tenancy.landlord_id ? landlord : tenant;
    const locale = dto.locale ?? (requesterProfile.locale === 'en' ? 'en' : 'fr');

    const contractId = randomUUID();
    const documentText = generateContractDocument({
      contractId,
      tenancyId,
      templateVersion: TEMPLATE_VERSION,
      locale,
      landlord,
      tenant,
      property: unit,
      unit,
      startDate: tenancy.start_date,
      rentAmount: String(tenancy.rent_amount),
      currency: tenancy.currency,
      billingCycle: tenancy.billing_cycle,
      noticePeriodDays: tenancy.notice_period_days,
      generatedAt: new Date(),
    });
    const documentUrl = await this.objectStorage.upload('contracts', Buffer.from(documentText, 'utf-8'), `${contractId}.txt`);

    const contract = await this.prisma.contract.create({
      data: { id: contractId, tenancyId, templateVersion: TEMPLATE_VERSION, locale, documentUrl },
    });

    this.events.emit(CONTRACT_GENERATED, {
      contractId: contract.id,
      tenancyId,
    } satisfies ContractGeneratedEvent);

    return this.toResponse(contract);
  }

  async getById(requesterId: string, contractId: string) {
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    // Contracts has no landlord/tenant columns of its own (schema doc B.6) —
    // authorization is delegated to Tenancies' own access check, which
    // throws 404 if the requester is neither party. Never a direct Prisma
    // read of Tenancies' tables, per CLAUDE.md's cross-module rule.
    await this.tenanciesService.getContractContext(requesterId, contract.tenancyId);

    return this.toResponse(contract);
  }

  // Public interface for Tenancies' getById(), which surfaces
  // `contract_status` on the tenancy detail response per
  // api-specification.md Section 6 ("linked contract status") — never a
  // direct Prisma read of Contracts' own table, per CLAUDE.md's
  // cross-module rule. A tenancy can have more than one generated contract
  // (e.g. regenerated in a different locale); the most recent one is what
  // the dashboard shows.
  async getLatestStatusForTenancy(tenancyId: string): Promise<string | null> {
    const latest = await this.prisma.contract.findFirst({
      where: { tenancyId },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    });
    return latest?.status ?? null;
  }

  private toResponse(contract: {
    id: string;
    tenancyId: string;
    templateVersion: string;
    locale: string;
    documentUrl: string;
    status: string;
    createdAt: Date;
  }) {
    return {
      id: contract.id,
      tenancy_id: contract.tenancyId,
      template_version: contract.templateVersion,
      locale: contract.locale,
      document_url: contract.documentUrl,
      status: contract.status,
      created_at: contract.createdAt,
    };
  }
}
