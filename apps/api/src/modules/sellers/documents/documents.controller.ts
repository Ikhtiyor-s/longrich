import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { createValidationPipe } from '../../../common/http/validation.pipe';
import { OwnershipGuard } from '../../../common/guards/ownership.guard';
import {
  RequireOwnership,
  type OwnershipRequestShape,
} from '../../../common/decorators/require-ownership.decorator';
import { IdempotencyService } from '../../../common/idempotency/idempotency.service';
import { ValidationError } from '../../../common/http/api-error';
import { JwtAuthGuard } from '../../identity/auth/auth.guard';
import { CurrentUser, type AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import { DocumentsService } from './documents.service';
import { DocumentAccessGuard, type LoadedDocumentResource } from './document-access.guard';
import { LoadedDocument, type SellerDocumentWithSeller } from './loaded-document.decorator';
import { CreateDocumentDto } from './dto/create-document.dto';

// Same resolver shape as applications' resolveApplicationOwner — DocumentAccessGuard
// (runs first) has already resolved whether the caller is a seller_members row for
// this document's seller.
const resolveDocumentOwner = (
  request: OwnershipRequestShape,
  resource: LoadedDocumentResource,
): string | null => (resource.isMember ? (request.user?.id ?? null) : null);

@Controller('v1/seller/documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post()
  @HttpCode(201)
  @UsePipes(createValidationPipe())
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDocumentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run('seller-documents:create', idempotencyKey, dto, () =>
      this.documentsService.create(user, dto),
    );
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('seller_id') sellerId?: string) {
    if (!sellerId) {
      throw new ValidationError('seller_id query parameter is required.', {
        seller_id: ['seller_id is required.'],
      });
    }
    return this.documentsService.list(user, sellerId);
  }

  @Get(':id')
  @UseGuards(DocumentAccessGuard, OwnershipGuard)
  @RequireOwnership<LoadedDocumentResource>(resolveDocumentOwner)
  findOne(@LoadedDocument() document: SellerDocumentWithSeller) {
    return this.documentsService.findOne(document);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @UseGuards(DocumentAccessGuard, OwnershipGuard)
  @RequireOwnership<LoadedDocumentResource>(resolveDocumentOwner)
  confirm(
    @LoadedDocument() document: SellerDocumentWithSeller,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run(`seller-documents:${id}:confirm`, idempotencyKey, {}, () =>
      this.documentsService.confirm(document, user),
    );
  }
}
