import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminService } from './admin.service';

// A narrower, spec-named sibling of Payments' own GET /admin/payments?status=
// (which stays put — api-specification.md Section 7 already documents it):
// this is specifically the subset needing manual review, not every payment.
@ApiTags('admin')
@ApiBearerAuth('access-token')
@Controller('admin/payments/disputes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminPaymentDisputesController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  @ApiOperation({ summary: 'Admin: payments stuck as failed or reconciling — needs manual review.' })
  list() {
    return this.adminService.listPaymentDisputes();
  }
}
