import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Brand } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { InvalidStateTransitionError, ValidationError } from '../../../common/http/api-error';
import type { AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import { toBrandPayload } from './brands.mapper';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

export interface RequestContext {
  requestId: string | null;
  traceId: string | null;
}

function uniqueConstraintError(): ValidationError {
  return new ValidationError('A brand with this name or slug already exists.', {
    name: ['already taken'],
    slug: ['already taken'],
  });
}

@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list() {
    const rows = await this.prisma.brand.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toBrandPayload);
  }

  async findByIdOrThrow(id: string): Promise<Brand> {
    const brand = await this.prisma.brand.findUnique({ where: { id } });
    if (!brand) {
      throw new NotFoundException('Brand not found.');
    }
    return brand;
  }

  async findOne(id: string) {
    return toBrandPayload(await this.findByIdOrThrow(id));
  }

  async create(actor: AuthenticatedUser, dto: CreateBrandDto, requestContext: RequestContext) {
    let created: Brand;
    try {
      created = await this.prisma.brand.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          logoObjectKey: dto.logo_object_key ?? null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw uniqueConstraintError();
      }
      throw error;
    }

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'brand.created',
      entityType: 'brand',
      entityId: created.id,
      after: { name: created.name, slug: created.slug },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    return toBrandPayload(created);
  }

  async update(
    id: string,
    actor: AuthenticatedUser,
    dto: UpdateBrandDto,
    requestContext: RequestContext,
  ) {
    const loaded = await this.findByIdOrThrow(id);

    const data: Prisma.BrandUncheckedUpdateManyInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.slug !== undefined) data.slug = dto.slug;
    if (dto.logo_object_key !== undefined) data.logoObjectKey = dto.logo_object_key;

    let claim: { count: number };
    try {
      claim = await this.prisma.brand.updateMany({
        where: { id, version: dto.version },
        data: { ...data, version: { increment: 1 } },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw uniqueConstraintError();
      }
      throw error;
    }

    if (claim.count === 0) {
      throw new InvalidStateTransitionError('Brand was modified by another request; reload and retry.');
    }

    const updated = await this.prisma.brand.findUniqueOrThrow({ where: { id } });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'brand.updated',
      entityType: 'brand',
      entityId: id,
      before: { name: loaded.name, slug: loaded.slug },
      after: { name: updated.name, slug: updated.slug },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    return toBrandPayload(updated);
  }
}
