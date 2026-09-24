import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ListListingChangesDto } from './dto/list-listing-changes.dto';
import { ListingChangesService } from './listing-changes.service';

@ApiTags('admin')
@ApiBearerAuth('access-token')
@Controller('admin/listing-changes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminListingChangesController {
  constructor(private readonly listingChanges: ListingChangesService) {}

  @Get()
  @ApiOperation({
    summary:
      'Admin: every landlord edit to a property or unit, with who made it — filter to changes made while a tenant was living there.',
  })
  list(@Query() query: ListListingChangesDto) {
    return this.listingChanges.listForAdmin({
      propertyId: query.property_id,
      unitId: query.unit_id,
      whileOccupied: query.while_occupied,
      cursor: query.cursor,
      limit: query.limit ?? 30,
    });
  }
}
