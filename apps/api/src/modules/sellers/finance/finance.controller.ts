import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ValidationError } from '../../../common/http/api-error';
import { JwtAuthGuard } from '../../identity/auth/auth.guard';
import { CurrentUser, type AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import { FinanceService } from './finance.service';

// Same no-:id-param shape as DashboardController/ProfileController (TZ §31):
// AuthenticatedUser carries no sellerId (a user can hold seller_members rows
// for more than one seller), so seller_id is an explicit query parameter
// rather than a guessed "the caller's seller."
@Controller('v1/seller/finance')
@UseGuards(JwtAuthGuard)
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('summary')
  getSummary(@CurrentUser() user: AuthenticatedUser, @Query('seller_id') sellerId?: string) {
    if (!sellerId) {
      throw new ValidationError('seller_id query parameter is required.', {
        seller_id: ['seller_id is required.'],
      });
    }
    return this.financeService.getSummary(user, sellerId);
  }
}
