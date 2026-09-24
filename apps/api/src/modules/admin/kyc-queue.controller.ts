import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminService } from './admin.service';

// The approve action itself (POST /admin/users/{id}/kyc/approve) stays on
// Auth's own AdminKycController — this is only the read side, per the "call
// the owning module's API, this is just a queue view" split in CLAUDE.md.
@ApiTags('admin')
@ApiBearerAuth('access-token')
@Controller('admin/kyc-queue')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminKycQueueController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  @ApiOperation({ summary: 'Admin: users who submitted an ID document that no admin has reviewed yet.' })
  list() {
    return this.adminService.listKycQueue();
  }
}
