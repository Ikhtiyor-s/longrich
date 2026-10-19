import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export interface RecordPriceChangeInput {
  offerId: string;
  oldPriceMinor: bigint | null;
  newPriceMinor: bigint;
  changedBy: string;
}

// Write-path only in G2 (no read endpoint ships this milestone — see
// api-contract-g2.md "Out of scope": the table/index exist to anticipate
// EXT-002's 7/30/90/365-day queries, not served yet). Append-only by
// construction: this service only ever INSERTs via tx.offerPriceHistory.create,
// never update/delete — callers MUST pass the same `tx` they're using for
// the offer row's own create/update, so both writes commit or roll back
// together (api-contract-g0.md "write one offer_price_history row in the
// same transaction").
@Injectable()
export class PriceHistoryService {
  async record(tx: Prisma.TransactionClient, input: RecordPriceChangeInput): Promise<void> {
    await tx.offerPriceHistory.create({
      data: {
        offerId: input.offerId,
        oldPriceMinor: input.oldPriceMinor,
        newPriceMinor: input.newPriceMinor,
        changedBy: input.changedBy,
      },
    });
  }
}
