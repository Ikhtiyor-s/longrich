import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { createValidationPipe } from '../../../common/http/validation.pipe';
import type { RequestWithId } from '../../../common/http/request-id.middleware';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { IdempotencyService } from '../../../common/idempotency/idempotency.service';
import { JwtAuthGuard } from '../../identity/auth/auth.guard';
import { CurrentUser, type AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import { MergeCasesService } from './merge-cases.service';
import { MergeCaseViewGuard } from './merge-case-view.guard';
import { DecisionReasonDto } from './dto/decision-reason.dto';
import { ListMergeCasesQueryDto } from './dto/list-merge-cases.query.dto';

// GET endpoints: category:manage OR merge_case:approve may view (MergeCaseViewGuard).
// POST decision endpoints: merge_case:approve only (PermissionGuard), per
// api-contract-g2.md.
@Controller('v1/admin/catalog/merge-proposals')
export class MergeCasesController {
  constructor(
    private readonly mergeCasesService: MergeCasesService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, MergeCaseViewGuard)
  @UsePipes(createValidationPipe())
  list(@Query() query: ListMergeCasesQueryDto) {
    return this.mergeCasesService.list(query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, MergeCaseViewGuard)
  findOne(@Param('id') id: string) {
    return this.mergeCasesService.findOne(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('merge_case:approve')
  async approve(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const loaded = await this.mergeCasesService.findByIdOrThrow(id);
    return this.idempotency.run(`merge:${id}:approve`, idempotencyKey, {}, () =>
      this.mergeCasesService.approve(loaded, user, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }

  @Post(':id/reject')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('merge_case:approve')
  @UsePipes(createValidationPipe())
  async reject(
    @Param('id') id: string,
    @Body() dto: DecisionReasonDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const loaded = await this.mergeCasesService.findByIdOrThrow(id);
    return this.idempotency.run(`merge:${id}:reject`, idempotencyKey, dto, () =>
      this.mergeCasesService.reject(loaded, user, dto.reason, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }
}
