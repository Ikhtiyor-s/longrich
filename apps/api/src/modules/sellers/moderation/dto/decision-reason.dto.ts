import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// REJECT and NEEDS_CHANGES both require a non-empty reason (ticket's own
// "done means" criteria) — the applicant reads it back via T-G1-2's GET
// (seller_applications.reason is already a column, no migration needed).
export class DecisionReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;
}
