import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContractsService } from './contracts.service';
import { GenerateContractDto } from './dto/generate-contract.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@ApiTags('contracts')
@ApiBearerAuth('access-token')
@Controller()
@UseGuards(JwtAuthGuard)
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Post('tenancies/:id/contracts')
  @ApiOperation({ summary: 'Generate a tenancy contract document — accessible by the landlord or the tenant.' })
  generateContract(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) tenancyId: string,
    @Body() dto: GenerateContractDto,
  ) {
    return this.contractsService.generateContract(user.userId, tenancyId, dto);
  }

  @Get('contracts/:id')
  @ApiOperation({ summary: 'Fetch a generated contract — document URL and status.' })
  getContract(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) contractId: string) {
    return this.contractsService.getById(user.userId, contractId);
  }
}
