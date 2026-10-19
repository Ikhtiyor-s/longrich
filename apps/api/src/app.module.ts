import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './common/prisma/prisma.module';
import { RequestIdMiddleware } from './common/http/request-id.middleware';
import { HttpExceptionFilter } from './common/http/http-exception.filter';
import { ResponseEnvelopeInterceptor } from './common/http/response-envelope.interceptor';
import { RedisModule } from './common/redis/redis.module';
import { StorageModule } from './common/storage/storage.module';
import { AuditModule } from './common/audit/audit.module';
import { TelemetryModule } from './common/telemetry/telemetry.module';
import { IdentityModule } from './modules/identity/identity.module';
import { SellersModule } from './modules/sellers/sellers.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { OffersModule } from './modules/offers/offers.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { CartModule } from './modules/cart/cart.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { FinanceModule } from './modules/finance/finance.module';
import { LogisticsModule } from './modules/logistics/logistics.module';
import { FulfillmentModule } from './modules/fulfillment/fulfillment.module';
import { ReturnsModule } from './modules/returns/returns.module';
import { SupportModule } from './modules/support/support.module';
import { SeoCmsModule } from './modules/seo-cms/seo-cms.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AdminAuditModule } from './modules/admin-audit/admin-audit.module';
import { HealthModule } from './common/health/health.module';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    StorageModule,
    AuditModule,
    TelemetryModule,
    IdentityModule,
    SellersModule,
    CatalogModule,
    OffersModule,
    PricingModule,
    InventoryModule,
    CartModule,
    CheckoutModule,
    OrdersModule,
    PaymentsModule,
    FinanceModule,
    LogisticsModule,
    FulfillmentModule,
    ReturnsModule,
    SupportModule,
    SeoCmsModule,
    NotificationsModule,
    AdminAuditModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
  ],
})
export class AppModule implements NestModule {
  // Global, single wiring path (G0 QA review major #5) — HttpExceptionFilter/
  // ResponseEnvelopeInterceptor apply to every route via APP_FILTER/
  // APP_INTERCEPTOR above, and RequestIdMiddleware applies to every route
  // here, instead of each feature module/controller re-declaring its own copy
  // (which let GET /health and GET /health/ready slip through with no
  // envelope/request_id at all).
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
