import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { createValidationPipe } from '../../../common/http/validation.pipe';
import type { RequestWithId } from '../../../common/http/request-id.middleware';
import { OwnershipGuard } from '../../../common/guards/ownership.guard';
import {
  RequireOwnership,
  type OwnershipRequestShape,
} from '../../../common/decorators/require-ownership.decorator';
import { IdempotencyService } from '../../../common/idempotency/idempotency.service';
import { JwtAuthGuard } from '../../identity/auth/auth.guard';
import { CurrentUser, type AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import { ApplicationsService } from './applications.service';
import { ApplicationAccessGuard, type LoadedApplicationResource } from './application-access.guard';
import {
  LoadedApplication,
  type SellerApplicationWithSeller,
} from './loaded-application.decorator';
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateApplicationDto } from './dto/update-application.dto';
import { AcceptContractDto } from './dto/accept-contract.dto';

// Resolver for the ownership check on routes scoped to an existing
// application: ApplicationAccessGuard (runs first) has already resolved
// whether the caller is a seller_members row for this application's seller
// and attached it as `isMember` — this resolver just surfaces the caller's
// own id back when authorized (so it compares equal to request.user.id) or
// null otherwise, which is what triggers OwnershipGuard's 403.
const resolveApplicationOwner = (
  request: OwnershipRequestShape,
  resource: LoadedApplicationResource,
): string | null => (resource.isMember ? (request.user?.id ?? null) : null);

@Controller('v1/seller-applications')
@UseGuards(JwtAuthGuard)
export class ApplicationsController {
  constructor(
    private readonly applicationsService: ApplicationsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post()
  @HttpCode(201)
  @UsePipes(createValidationPipe())
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateApplicationDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run('sel-app:create', idempotencyKey, dto, () =>
      this.applicationsService.create(user.id, dto),
    );
  }

  @Get(':id')
  @UseGuards(ApplicationAccessGuard, OwnershipGuard)
  @RequireOwnership<LoadedApplicationResource>(resolveApplicationOwner)
  findOne(@LoadedApplication() application: SellerApplicationWithSeller) {
    return this.applicationsService.findOne(application);
  }

  @Patch(':id')
  @UseGuards(ApplicationAccessGuard, OwnershipGuard)
  @RequireOwnership<LoadedApplicationResource>(resolveApplicationOwner)
  @UsePipes(createValidationPipe())
  update(
    @LoadedApplication() application: SellerApplicationWithSeller,
    @Body() dto: UpdateApplicationDto,
  ) {
    return this.applicationsService.update(application, dto);
  }

  @Post(':id/contract-acceptance')
  @HttpCode(201)
  @UseGuards(ApplicationAccessGuard, OwnershipGuard)
  @RequireOwnership<LoadedApplicationResource>(resolveApplicationOwner)
  @UsePipes(createValidationPipe())
  acceptContract(
    @LoadedApplication() application: SellerApplicationWithSeller,
    @Body() dto: AcceptContractDto,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    // "sel-app:" (not "seller-applications:") specifically to stay under
    // commerce.idempotency_keys.scope's VarChar(64) cap once a real 36-char
    // UUID and ":contract-acceptance" are appended — the longer prefix
    // overflowed by 12 chars (G1 QA review major #1); every scope string in
    // this controller + moderation.controller.ts uses the same shorter
    // prefix now, not just the ones that were over cap, so the whole
    // "seller application" idempotency namespace stays consistent.
    return this.idempotency.run(`sel-app:${id}:contract-acceptance`, idempotencyKey, dto, () =>
      this.applicationsService.acceptContract(application, dto),
    );
  }

  @Post(':id/submit')
  @HttpCode(200)
  @UseGuards(ApplicationAccessGuard, OwnershipGuard)
  @RequireOwnership<LoadedApplicationResource>(resolveApplicationOwner)
  submit(
    @LoadedApplication() application: SellerApplicationWithSeller,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run(`sel-app:${id}:submit`, idempotencyKey, {}, () =>
      this.applicationsService.submit(application, user, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }
}
