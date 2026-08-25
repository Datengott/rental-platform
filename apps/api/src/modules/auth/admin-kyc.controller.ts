import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { ApproveKycDto } from './dto/approve-kyc.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from './decorators/current-user.decorator';

@ApiTags('admin')
@ApiBearerAuth('access-token')
@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminKycController {
  constructor(private readonly usersService: UsersService) {}

  @Post(':id/kyc/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: advance a user\'s KYC tier after reviewing their documents.' })
  @ApiParam({ name: 'id', description: 'Target user id' })
  approveKyc(
    @Param('id', ParseUUIDPipe) targetUserId: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body() dto: ApproveKycDto,
  ) {
    return this.usersService.approveKyc(targetUserId, admin.userId, dto);
  }
}
