import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ValidationError } from '../../../common/http/api-error';
import { JwtAuthGuard } from '../../identity/auth/auth.guard';
import { CurrentUser, type AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import { DashboardService } from './dashboard.service';

// Same shape as ProfileController (TZ §31/longrich-tz-master-blueprint.txt's
// "GET /v1/seller/dashboard" entry): no :id path param, seller_id as a query
// parameter because AuthenticatedUser carries no sellerId and a user can
// hold seller_members rows for more than one seller.
@Controller('v1/seller/dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser, @Query('seller_id') sellerId?: string) {
    if (!sellerId) {
      throw new ValidationError('seller_id query parameter is required.', {
        seller_id: ['seller_id is required.'],
      });
    }
    return this.dashboardService.getDashboard(user, sellerId);
  }
}
