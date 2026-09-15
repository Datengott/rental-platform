import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PropertiesService } from './properties.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { CreateUnitDto } from './dto/create-unit.dto';
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
