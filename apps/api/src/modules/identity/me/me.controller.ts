import { Body, Controller, Get, Patch, UseGuards, UsePipes } from '@nestjs/common';
import type { Locale } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { createValidationPipe } from '../../../common/http/validation.pipe';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { toMePayload } from '../auth/auth-response.mapper';
import { UpdateMeDto } from '../dto/update-me.dto';

@Controller('v1/me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return toMePayload(row);
  }

  @Patch()
  @UsePipes(createValidationPipe())
  async updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMeDto) {
    const row = await this.prisma.user.update({
      where: { id: user.id },
      data: dto.locale ? { locale: dto.locale.toUpperCase() as Locale } : {},
    });
    return toMePayload(row);
  }
}
