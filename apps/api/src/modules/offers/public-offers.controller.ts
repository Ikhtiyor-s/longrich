import { Controller, Get, Param, Query, UsePipes } from '@nestjs/common';
import { createValidationPipe } from '../../common/http/validation.pipe';
import { OffersService } from './seller-offers.service';
import { ListVariantOffersQueryDto } from './dto/list-variant-offers.query.dto';

// Lives in the offers module despite the /v1/catalog/... URL prefix
// (api-contract-g2.md: route path and owning module folder are
// independent — same non-issue as ApplicationsController/
// ModerationController both sharing v1/seller-applications). No guard: this
// is the public offer-comparison view.
@Controller('v1/catalog/variants')
export class PublicOffersController {
  constructor(private readonly offersService: OffersService) {}

  @Get(':id/offers')
  @UsePipes(createValidationPipe())
  list(@Param('id') variantId: string, @Query() query: ListVariantOffersQueryDto) {
    return this.offersService.listPublicOffersForVariant(variantId, query);
  }
}
