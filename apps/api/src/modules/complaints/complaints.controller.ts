import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ComplaintsService } from './complaints.service';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import { ListComplaintsDto } from './dto/list-complaints.dto';
import { UpdateComplaintStatusDto } from './dto/update-complaint-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

const MAX_MEDIA_FILES = 10;

@ApiTags('complaints')
@ApiBearerAuth('access-token')
@Controller()
@UseGuards(JwtAuthGuard)
export class ComplaintsController {
  constructor(private readonly complaintsService: ComplaintsService) {}

  @Post('tenancies/:id/complaints')
  @UseInterceptors(FilesInterceptor('media', MAX_MEDIA_FILES))
  @ApiOperation({ summary: 'Tenant: report a maintenance issue, with optional photo/video attachments.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        description: { type: 'string' },
        media: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
      required: ['category', 'description'],
    },
  })
  createComplaint(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) tenancyId: string,
    @Body() dto: CreateComplaintDto,
    @UploadedFiles() media: Express.Multer.File[] = [],
  ) {
    return this.complaintsService.createComplaint(user.userId, tenancyId, dto, media);
  }

  @Get('landlords/me/complaints')
  @ApiOperation({ summary: "Landlord: aggregate view of your properties' complaints, filterable by unit/status/category." })
  listMyComplaints(@CurrentUser() user: AuthenticatedUser, @Query() query: ListComplaintsDto) {
    return this.complaintsService.listForLandlord(user.userId, query);
  }

  @Patch('complaints/:id/status')
  @ApiOperation({ summary: 'Landlord: update a complaint\'s status, with an optional note.' })
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) complaintId: string,
    @Body() dto: UpdateComplaintStatusDto,
  ) {
    return this.complaintsService.updateStatus(user.userId, complaintId, dto);
  }
}
