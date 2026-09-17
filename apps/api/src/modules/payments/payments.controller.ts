import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ApiException } from '../../common/exceptions/api.exception';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@ApiTags('payments')
@ApiBearerAuth('access-token')
@Controller()
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('tenancies/:id/payments')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Initiate a rent payment — validated against notice/advance-month rules first.' })
  async initiatePayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) tenancyId: string,
    @Body() dto: CreatePaymentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    if (!idempotencyKey) {
      throw new ApiException('VALIDATION_ERROR', 'The Idempotency-Key header is required.', HttpStatus.BAD_REQUEST, [
        { field: 'Idempotency-Key', message: 'is required' },
      ]);
    }
    return this.paymentsService.initiatePayment(user.userId, tenancyId, idempotencyKey, dto);
  }

  @Get('tenancies/:id/ledger')
  @ApiOperation({ summary: 'Full payment history and running balance for a tenancy.' })
  getLedger(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) tenancyId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.paymentsService.getLedger(user.userId, tenancyId, cursor, limit ? Number(limit) : undefined);
  }

  @Get('payments/:id/receipt')
  @ApiOperation({ summary: 'Download link for a confirmed payment receipt.' })
  getReceipt(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) paymentId: string) {
    return this.paymentsService.getReceipt(user.userId, paymentId);
  }
}
