import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { FlagListingDto } from './dto/flag-listing.dto';
import { AdminService } from './admin.service';

@ApiTags('admin')
@ApiBearerAuth('access-token')
@Controller('admin/listings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminListingModerationController {
  constructor(private readonly adminService: AdminService) {}

  @Get('flagged')
  @ApiOperation({ summary: 'Admin: units currently flagged for review, with who flagged them and why.' })
  listFlagged() {
    return this.adminService.listFlaggedListings();
  }

  @Post(':id/flag')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: flag a unit for review — removes it from public listings until resolved.' })
  flag(
    @Param('id', ParseUUIDPipe) unitId: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body() dto: FlagListingDto,
  ) {
    return this.adminService.flagListing(unitId, admin.userId, dto.reason);
  }

  @Post(':id/unflag')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: dismiss a flag — the listing is unchanged, just visible again.' })
  unflag(@Param('id', ParseUUIDPipe) unitId: string, @CurrentUser() admin: AuthenticatedUser) {
    return this.adminService.unflagListing(unitId, admin.userId);
  }

  @Post(':id/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: take a listing down (back to draft) and resolve its flag, if any.' })
  remove(
    @Param('id', ParseUUIDPipe) unitId: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body() dto: FlagListingDto,
  ) {
    return this.adminService.removeListing(unitId, admin.userId, dto.reason);
  }
}
