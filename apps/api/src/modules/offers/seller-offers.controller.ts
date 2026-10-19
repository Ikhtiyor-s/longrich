import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { createValidationPipe } from '../../common/http/validation.pipe';
import type { RequestWithId } from '../../common/http/request-id.middleware';
import { ValidationError } from '../../common/http/api-error';
import { OwnershipGuard } from '../../common/guards/ownership.guard';
import {
  RequireOwnership,
  type OwnershipRequestShape,
} from '../../common/decorators/require-ownership.decorator';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { JwtAuthGuard } from '../identity/auth/auth.guard';
import { CurrentUser, type AuthenticatedUser } from '../identity/auth/current-user.decorator';
import { SellerPermissionGuard } from '../sellers/members/seller-permission.guard';
import { RequireSellerPermission } from '../sellers/members/require-seller-permission.decorator';
import { OffersService } from './seller-offers.service';
import { OfferAccessGuard, type LoadedOfferResource } from './offer-access.guard';
import { LoadedOffer, type SellerOfferWithSeller } from './loaded-offer.decorator';
import { CreateOfferDto } from './dto/create-offer.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import { ListSellerOffersQueryDto } from './dto/list-offers.query.dto';

// Resolver for the ownership check on routes scoped to an existing offer:
// OfferAccessGuard (runs first) has already resolved whether the caller
// has their own seller_members row for this offer's seller — same shape as
// MembersController's resolveMemberOwner /
// DocumentsController's resolveDocumentOwner.
const resolveOfferOwner = (
  request: OwnershipRequestShape,
  resource: LoadedOfferResource,
): string | null => (resource.callerMembership ? (request.user?.id ?? null) : null);

@Controller('v1/seller/offers')
@UseGuards(JwtAuthGuard)
export class SellerOffersController {
  constructor(
    private readonly offersService: OffersService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @UsePipes(createValidationPipe())
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListSellerOffersQueryDto) {
    if (!query.seller_id) {
      throw new ValidationError('seller_id query parameter is required.', {
        seller_id: ['seller_id is required.'],
      });
    }
    return this.offersService.list(user, query.seller_id, query);
  }

  // Idempotency-Key is REQUIRED on this endpoint (not merely supported) —
  // api-contract-g2.md's own explicit instruction for this specific route.
  @Post()
  @HttpCode(201)
  @UsePipes(createValidationPipe())
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOfferDto,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey) {
      throw new ValidationError('Idempotency-Key header is required.', {
        idempotency_key: ['Idempotency-Key header is required.'],
      });
    }
    return this.idempotency.run('off:create', idempotencyKey, dto, () =>
      this.offersService.create(user, dto, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }

  @Get(':id')
  @UseGuards(OfferAccessGuard, OwnershipGuard)
  @RequireOwnership<LoadedOfferResource>(resolveOfferOwner)
  findOne(@LoadedOffer() offer: SellerOfferWithSeller) {
    return this.offersService.findOne(offer);
  }

  @Patch(':id')
  @HttpCode(200)
  @UseGuards(OfferAccessGuard, OwnershipGuard, SellerPermissionGuard)
  @RequireOwnership<LoadedOfferResource>(resolveOfferOwner)
  @RequireSellerPermission('seller:offers:manage')
  @UsePipes(createValidationPipe())
  update(
    @CurrentUser() user: AuthenticatedUser,
    @LoadedOffer() offer: SellerOfferWithSeller,
    @Body() dto: UpdateOfferDto,
    @Req() req: RequestWithId,
  ) {
    return this.offersService.update(user, offer, dto, {
      requestId: req.requestId ?? null,
      traceId: req.traceId ?? null,
    });
  }

  @Post(':id/submit')
  @HttpCode(200)
  @UseGuards(OfferAccessGuard, OwnershipGuard, SellerPermissionGuard)
  @RequireOwnership<LoadedOfferResource>(resolveOfferOwner)
  @RequireSellerPermission('seller:offers:manage')
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @LoadedOffer() offer: SellerOfferWithSeller,
    @Param('id') id: string,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run(`off:${id}:submit`, idempotencyKey, {}, () =>
      this.offersService.submit(user, offer, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }
}
