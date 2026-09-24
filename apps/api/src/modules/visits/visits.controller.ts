import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { VisitsService } from './visits.service';
import { CreateVisitRequestDto } from './dto/create-visit-request.dto';
import { RespondVisitRequestDto } from './dto/respond-visit-request.dto';
import { ListVisitRequestsDto } from './dto/list-visit-requests.dto';
import { ListUnitInterestsDto } from './dto/list-unit-interests.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@ApiTags('visits')
@ApiBearerAuth('access-token')
@Controller()
@UseGuards(JwtAuthGuard)
export class VisitsController {
  constructor(private readonly visitsService: VisitsService) {}

  @Post('units/:id/visit-requests')
  @ApiOperation({ summary: 'Request a visit to a unit — propose one or more time windows.' })
  createVisitRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) unitId: string,
    @Body() dto: CreateVisitRequestDto,
  ) {
    return this.visitsService.createVisitRequest(user.userId, unitId, dto);
  }

  @Patch('visit-requests/:id/respond')
  @ApiOperation({ summary: 'Landlord: accept, decline, or propose an alternate time.' })
  respond(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) visitRequestId: string,
    @Body() dto: RespondVisitRequestDto,
  ) {
    return this.visitsService.respond(user.userId, visitRequestId, dto);
  }

  @Get('landlords/me/visit-requests')
  @ApiOperation({ summary: "Landlord inbox — your properties' visit requests." })
  listMyVisitRequests(@CurrentUser() user: AuthenticatedUser, @Query() query: ListVisitRequestsDto) {
    return this.visitsService.listForLandlord(user.userId, query);
  }

  @Post('units/:id/interest')
  @ApiOperation({ summary: 'Express interest in a unit — lighter-weight than requesting a visit, no scheduling.' })
  expressInterest(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) unitId: string) {
    return this.visitsService.expressInterest(user.userId, unitId);
  }

  @Get('tenants/me/interests')
  @ApiOperation({ summary: 'Units you have expressed interest in (tenant side).' })
  listMyInterestsAsTenant(@CurrentUser() user: AuthenticatedUser) {
    return this.visitsService.listInterestsForTenant(user.userId);
  }

  @Get('landlords/me/interests')
  @ApiOperation({ summary: 'Landlord inbox — tenants who expressed interest in your units.' })
  listMyInterests(@CurrentUser() user: AuthenticatedUser, @Query() query: ListUnitInterestsDto) {
    return this.visitsService.listInterestsForLandlord(user.userId, query);
  }
}
