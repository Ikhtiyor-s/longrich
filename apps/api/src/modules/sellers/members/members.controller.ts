import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { createValidationPipe } from '../../../common/http/validation.pipe';
import { ValidationError } from '../../../common/http/api-error';
import { OwnershipGuard } from '../../../common/guards/ownership.guard';
import {
  RequireOwnership,
  type OwnershipRequestShape,
} from '../../../common/decorators/require-ownership.decorator';
import { IdempotencyService } from '../../../common/idempotency/idempotency.service';
import { JwtAuthGuard } from '../../identity/auth/auth.guard';
import { CurrentUser, type AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import { MembersService } from './members.service';
import { MemberAccessGuard, type LoadedMemberResource } from './member-access.guard';
import { LoadedMember, type SellerMemberWithSeller } from './loaded-member.decorator';
import { SellerPermissionGuard } from './seller-permission.guard';
import { RequireSellerPermission } from './require-seller-permission.decorator';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

// Resolver for the ownership check on routes scoped to an existing member
// row: MemberAccessGuard (runs first) has already resolved whether the
// caller has their own seller_members row for this target member's seller —
// this resolver just surfaces the caller's own id back when so (so it
// compares equal to request.user.id) or null otherwise, which is what
// triggers OwnershipGuard's 403. Same pattern as
// applications/documents' resolveApplicationOwner/resolveDocumentOwner; see
// docs/open-questions.md #30 for why this ticket resolves the design note by
// reusing OwnershipGuard unmodified rather than changing it.
const resolveMemberOwner = (
  request: OwnershipRequestShape,
  resource: LoadedMemberResource,
): string | null => (resource.callerMembership ? (request.user?.id ?? null) : null);

@Controller('v1/seller/members')
@UseGuards(JwtAuthGuard)
export class MembersController {
  constructor(
    private readonly membersService: MembersService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('seller_id') sellerId?: string) {
    if (!sellerId) {
      throw new ValidationError('seller_id query parameter is required.', {
        seller_id: ['seller_id is required.'],
      });
    }
    return this.membersService.list(user, sellerId);
  }

  @Post()
  @HttpCode(201)
  @UsePipes(createValidationPipe())
  invite(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InviteMemberDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run('seller-members:invite', idempotencyKey, dto, () =>
      this.membersService.invite(user, dto),
    );
  }

  @Patch(':id')
  @HttpCode(200)
  @UseGuards(MemberAccessGuard, OwnershipGuard, SellerPermissionGuard)
  @RequireOwnership<LoadedMemberResource>(resolveMemberOwner)
  @RequireSellerPermission('seller:members:manage')
  @UsePipes(createValidationPipe())
  updateRole(
    @CurrentUser() user: AuthenticatedUser,
    @LoadedMember() targetMember: SellerMemberWithSeller,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.membersService.updateRole(user, targetMember, dto);
  }
}
