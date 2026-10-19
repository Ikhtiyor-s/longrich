import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { createValidationPipe } from '../../../common/http/validation.pipe';
import { ValidationError } from '../../../common/http/api-error';
import { IdempotencyService } from '../../../common/idempotency/idempotency.service';
import { JwtAuthGuard } from '../../identity/auth/auth.guard';
import { CurrentUser, type AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import { FinanceService } from './finance.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';

// Seller-member-scoped actor (service-level seller:finance:view/
// seller:bank:manage checks, same style as MembersService.invite/
// ProfileService.updateProfile) — NOT the admin-side review actor, which
// lives in BankAccountReviewController below this same base path, same
// split ApplicationsController/ModerationController already use for
// v1/seller-applications.
@Controller('v1/seller/bank-accounts')
@UseGuards(JwtAuthGuard)
export class BankAccountsController {
  constructor(
    private readonly financeService: FinanceService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('seller_id') sellerId?: string) {
    if (!sellerId) {
      throw new ValidationError('seller_id query parameter is required.', {
        seller_id: ['seller_id is required.'],
      });
    }
    return this.financeService.listBankAccounts(user, sellerId);
  }

  @Post()
  @HttpCode(201)
  @UsePipes(createValidationPipe())
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBankAccountDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run('bank-accounts:create', idempotencyKey, dto, () =>
      this.financeService.createBankAccount(user, dto),
    );
  }
}
