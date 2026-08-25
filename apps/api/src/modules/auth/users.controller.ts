import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateMeDto } from './dto/update-me.dto';
import { UploadKycDocumentDto, KYC_DOCUMENT_TYPES } from './dto/upload-kyc-document.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from './decorators/current-user.decorator';

@ApiTags('users')
@ApiBearerAuth('access-token')
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Current user profile, roles, and KYC tier.' })
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getMe(user.userId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Partially update the current user profile.' })
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMeDto) {
    return this.usersService.updateMe(user.userId, dto);
  }

  @Post('me/kyc-documents')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload an ID/ownership document for KYC review.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        document_type: { type: 'string', enum: [...KYC_DOCUMENT_TYPES] },
        document_ref: { type: 'string' },
        file: { type: 'string', format: 'binary' },
      },
      required: ['document_type', 'document_ref', 'file'],
    },
  })
  uploadKycDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UploadKycDocumentDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.usersService.uploadKycDocument(user.userId, dto, file);
  }
}
