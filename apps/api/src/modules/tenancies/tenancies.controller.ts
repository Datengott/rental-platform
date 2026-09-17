import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenanciesService } from './tenancies.service';
import { CreateTenancyDto } from './dto/create-tenancy.dto';
import { UpdateReminderSettingsDto } from './dto/update-reminder-settings.dto';
import { CreateTerminationNoticeDto } from './dto/create-termination-notice.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@ApiTags('tenancies')
@ApiBearerAuth('access-token')
@Controller()
@UseGuards(JwtAuthGuard)
export class TenanciesController {
  constructor(private readonly tenanciesService: TenanciesService) {}

  @Post('tenancies')
  @ApiOperation({ summary: 'Create a tenancy on a vacant unit (typically after a visit -> agreement).' })
  createTenancy(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTenancyDto) {
    return this.tenanciesService.createTenancy(user.userId, dto);
  }

  @Get('landlords/me/tenancies')
  @ApiOperation({ summary: 'Occupancy dashboard data source — your tenancies.' })
  listMyTenancies(@CurrentUser() user: AuthenticatedUser) {
    return this.tenanciesService.listForLandlord(user.userId);
  }

  @Get('tenancies/:id')
  @ApiOperation({ summary: 'Full tenancy detail — accessible by the landlord or the tenant.' })
  getTenancy(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) tenancyId: string) {
    return this.tenanciesService.getById(user.userId, tenancyId);
  }

  @Patch('tenancies/:id/reminder-settings')
  @ApiOperation({ summary: 'Adjust rent-expiry reminder timing for a tenancy.' })
  updateReminderSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) tenancyId: string,
    @Body() dto: UpdateReminderSettingsDto,
  ) {
    return this.tenanciesService.updateReminderSettings(user.userId, tenancyId, dto);
  }

  @Post('tenancies/:id/termination-notices')
  @ApiOperation({ summary: 'Issue a termination notice — validates the statutory notice-period floor.' })
  createTerminationNotice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) tenancyId: string,
    @Body() dto: CreateTerminationNoticeDto,
  ) {
    return this.tenanciesService.createTerminationNotice(user.userId, tenancyId, dto);
  }

  @Get('tenancies/:id/termination-notices')
  @ApiOperation({ summary: 'History of termination notices on this tenancy.' })
  listTerminationNotices(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) tenancyId: string) {
    return this.tenanciesService.listTerminationNotices(user.userId, tenancyId);
  }
}
