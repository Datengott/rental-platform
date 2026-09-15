import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UnitsService } from './units.service';
import { UploadUnitPhotoDto } from './dto/upload-unit-photo.dto';
import { SearchUnitsDto } from './dto/search-units.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@ApiTags('units')
@Controller()
export class UnitsController {
  constructor(private readonly unitsService: UnitsService) {}

  @Post('units/:id/photos')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload a geo-tagged unit photo (first photo publishes the unit).' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        geo_latitude: { type: 'number' },
        geo_longitude: { type: 'number' },
        captured_at: { type: 'string', format: 'date-time' },
      },
      required: ['file'],
    },
  })
  uploadPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) unitId: string,
    @Body() dto: UploadUnitPhotoDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.unitsService.uploadPhoto(user.userId, unitId, dto, file);
  }

  @Get('units')
  @ApiOperation({ summary: 'Public search over listed units.' })
  searchUnits(@Query() query: SearchUnitsDto) {
    return this.unitsService.searchUnits(query);
  }

  @Get('landlords/me/units')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: "Your own unit inventory, all statuses — feeds the occupancy dashboard." })
  getMyUnits(@CurrentUser() user: AuthenticatedUser) {
    return this.unitsService.getLandlordUnits(user.userId);
  }

  @Patch('units/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update rent/description, or move between vacant and reserved.' })
  updateUnit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) unitId: string,
    @Body() dto: UpdateUnitDto,
  ) {
    return this.unitsService.updateUnit(user.userId, unitId, dto);
  }
}
