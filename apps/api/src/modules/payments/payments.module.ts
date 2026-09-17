import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenanciesModule } from '../tenancies/tenancies.module';
import { PaymentsController } from './payments.controller';
import { WebhooksController } from './webhooks.controller';
import { AdminPaymentsController } from './admin-payments.controller';
import { PaymentsService } from './payments.service';
import { PAYMENT_GATEWAY } from './gateway/payment-gateway';
import { SimulatedPaymentGateway } from './gateway/simulated-payment-gateway';

@Module({
  // AuthModule for the guards. TenanciesModule for
  // TenanciesService.getPaymentConstraints() — a genuine bidirectional
  // dependency with Tenancies (see the forwardRef comment there), so
  // imported with forwardRef here too.
  imports: [AuthModule, forwardRef(() => TenanciesModule)],
  controllers: [PaymentsController, WebhooksController, AdminPaymentsController],
  providers: [
    PaymentsService,
    // Swap for a RealCamPayGateway/RealMonetbilGateway once credentials
    // exist — nothing else in this module depends on which one is
    // registered here, only on the PaymentGateway interface.
    { provide: PAYMENT_GATEWAY, useClass: SimulatedPaymentGateway },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
