import { PriceHistoryService } from './price-history.service';

describe('PriceHistoryService', () => {
  it('record() inserts exactly one offer_price_history row via the provided tx, never update/delete', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'hist-1' });
    const tx = { offerPriceHistory: { create } } as never;
    const service = new PriceHistoryService();

    await service.record(tx, {
      offerId: 'offer-1',
      oldPriceMinor: null,
      newPriceMinor: 4500000n,
      changedBy: 'user-1',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        offerId: 'offer-1',
        oldPriceMinor: null,
        newPriceMinor: 4500000n,
        changedBy: 'user-1',
      },
    });
  });

  it('passes through a non-null oldPriceMinor on a subsequent price change', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'hist-2' });
    const tx = { offerPriceHistory: { create } } as never;
    const service = new PriceHistoryService();

    await service.record(tx, {
      offerId: 'offer-1',
      oldPriceMinor: 4500000n,
      newPriceMinor: 5000000n,
      changedBy: 'user-1',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        offerId: 'offer-1',
        oldPriceMinor: 4500000n,
        newPriceMinor: 5000000n,
        changedBy: 'user-1',
      },
    });
  });
});
