import { IsInt, Min } from 'class-validator';

// Same CAS reasoning as catalog/moderation/dto/approve-decision.dto.ts —
// api-contract-g2.md's "approve: no body" prose is overridden by its own
// explicit stale-version 409 acceptance test, which only works if the
// caller submits the version it read. Flagged in the implementation report.
export class ApproveDecisionDto {
  @IsInt()
  @Min(1)
  version!: number;
}
