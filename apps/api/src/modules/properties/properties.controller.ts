import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PropertiesService } from './properties.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { ListListingChangesDto } from './dto/list-listing-changes.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@ApiTags('properties')
@ApiBearerAuth('access-token')
@Controller()
@UseGuards(JwtAuthGuard)
export class PropertiesController {
  constructor(private readonly propertiesService: PropertiesService) {}

  @Post('properties')
  @ApiOperation({ summary: 'Create a property (creating one is what makes you a landlord).' })
  createProperty(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePropertyDto) {
    return this.propertiesService.createProperty(user.userId, dto);
  }

  @Get('landlords/me/properties')
  @ApiOperation({ summary: 'Your properties, with unit counts — so you can edit them or add units after a reload.' })
  listMyProperties(@CurrentUser() user: AuthenticatedUser) {
    return this.propertiesService.listForLandlord(user.userId);
  }

  @Patch('properties/:id')
  @ApiOperation({
    summary:
      'Edit any detail of your property. Every real change is recorded in the change history, including whether a tenant was living in one of its units at the time.',
  })
  updateProperty(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) propertyId: string,
    @Body() dto: UpdatePropertyDto,
  ) {
    return this.propertiesService.updateProperty(user.userId, propertyId, dto);
  }

  @Get('landlords/me/listing-changes')
  @ApiOperation({ summary: 'Change history of your properties and units, newest first.' })
  listMyChanges(@CurrentUser() user: AuthenticatedUser, @Query() query: ListListingChangesDto) {
    return this.propertiesService.listChangesForLandlord(user.userId, query);
  }

  @Post('properties/:id/units')
  @ApiOperation({ summary: 'Add a unit to one of your properties.' })
  createUnit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) propertyId: string,
    @Body() dto: CreateUnitDto,
  ) {
    return this.propertiesService.createUnit(user.userId, propertyId, dto);
  }
}
