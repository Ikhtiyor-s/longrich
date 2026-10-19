import { CatalogService } from './catalog.service';

function buildService(prismaOverrides: Record<string, unknown>) {
  const prisma = prismaOverrides;
  return new CatalogService(prisma as never);
}

describe('CatalogService', () => {
  it('findCategoryById delegates to prisma.category.findUnique by id', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: 'category-1', slug: 'electronics' });
    const service = buildService({ category: { findUnique } });

    await expect(service.findCategoryById('category-1')).resolves.toEqual({
      id: 'category-1',
      slug: 'electronics',
    });
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'category-1' } });
  });

  it('findCategoryById returns null when no category exists', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const service = buildService({ category: { findUnique } });

    await expect(service.findCategoryById('missing')).resolves.toBeNull();
  });

  it('findVariantById delegates to prisma.productVariant.findUnique by id', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: 'variant-1', status: 'PUBLISHED' });
    const service = buildService({ productVariant: { findUnique } });

    await expect(service.findVariantById('variant-1')).resolves.toEqual({
      id: 'variant-1',
      status: 'PUBLISHED',
    });
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'variant-1' } });
  });

  it('findVariantById returns null when no variant exists', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const service = buildService({ productVariant: { findUnique } });

    await expect(service.findVariantById('missing')).resolves.toBeNull();
  });
});
