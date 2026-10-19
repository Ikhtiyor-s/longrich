import { IsInt, Min } from 'class-validator';

// api-contract-g2.md's own prose says "approve: no body", but its explicit
// acceptance test ("queue-fetch read version 3, concurrent edit bumps it to
// 4, approve must then 409") is only satisfiable if the caller submits the
// version it read — a plain status-only CAS can't detect a version bump
// that didn't also change status. Resolving the prose-vs-test contradiction
// in the test's favor (the literally asserted "Done means" behavior),
// flagged loudly in the implementation report as a contract ambiguity, not
// a silent guess.
export class ApproveDecisionDto {
  @IsInt()
  @Min(1)
  version!: number;
}
