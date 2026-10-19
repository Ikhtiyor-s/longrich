import { SellersService } from './sellers.service';

function buildService(prismaOverrides: Record<string, unknown>) {
  const prisma = prismaOverrides;
  return new SellersService(prisma as never);
}

describe('SellersService', () => {
  it('findById delegates to prisma.seller.findUnique by id', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: 'seller-1' });
    const service = buildService({ seller: { findUnique } });

    await expect(service.findById('seller-1')).resolves.toEqual({ id: 'seller-1' });
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'seller-1' } });
  });

  it('findById returns null when no seller exists', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const service = buildService({ seller: { findUnique } });

    await expect(service.findById('missing')).resolves.toBeNull();
  });

  it('findMembership delegates to prisma.sellerMember.findUnique on the composite seller_id+user_id key', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: 'member-1', role: 'OWNER' });
    const service = buildService({ sellerMember: { findUnique } });

    await expect(service.findMembership('seller-1', 'user-1')).resolves.toEqual({
      id: 'member-1',
      role: 'OWNER',
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { sellerId_userId: { sellerId: 'seller-1', userId: 'user-1' } },
    });
  });

  it('findMembership returns null when the caller does not belong to the seller', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const service = buildService({ sellerMember: { findUnique } });

    await expect(service.findMembership('seller-1', 'stranger')).resolves.toBeNull();
  });
});
