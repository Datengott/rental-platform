import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ListAuditLogDto } from './dto/list-audit-log.dto';
import { AdminService } from './admin.service';

@ApiTags('admin')
@ApiBearerAuth('access-token')
@Controller('admin/audit-log')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminAuditLogController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  @ApiOperation({ summary: 'Admin: full history of admin actions, filterable by target.' })
  list(@Query() query: ListAuditLogDto) {
    return this.adminService.listAuditLog(query);
  }
}
