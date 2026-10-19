import { Body, Controller, Get, Patch, Query, UseGuards, UsePipes } from '@nestjs/common';
import { createValidationPipe } from '../../../common/http/validation.pipe';
import { ValidationError } from '../../../common/http/api-error';
import { JwtAuthGuard } from '../../identity/auth/auth.guard';
import { CurrentUser, type AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

// No :id path param (TZ §31: bare GET/PATCH /v1/seller/profile) and
// AuthenticatedUser carries no sellerId (a user can hold seller_members rows
// for more than one seller — same reason GET /v1/seller/members and GET
// /v1/seller/documents already require an explicit seller_id query param
// rather than guessing "the caller's seller"). PATCH carries seller_id in
// the body instead, same shape as InviteMemberDto/CreateDocumentDto.
@Controller('v1/seller/profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser, @Query('seller_id') sellerId?: string) {
    if (!sellerId) {
      throw new ValidationError('seller_id query parameter is required.', {
        seller_id: ['seller_id is required.'],
      });
    }
    return this.profileService.getProfile(user, sellerId);
  }

  @Patch()
  @UsePipes(createValidationPipe())
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.profileService.updateProfile(user, dto);
  }
}
