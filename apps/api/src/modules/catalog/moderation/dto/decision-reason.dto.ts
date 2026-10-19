import { IsInt, IsNotEmpty, IsString, Min, MaxLength } from 'class-validator';

// Same `reason` shape as sellers/moderation/dto/decision-reason.dto.ts and
// merge-cases' own copy (IsNotEmpty, MaxLength(2000)) — plus `version` for
// the same CAS reason ApproveDecisionDto's comment explains (this ticket's
// own explicit stale-version 409 test). The three decision-reason DTO
// copies across modules are therefore not byte-identical in this one
// ticket's case; flagged as a deliberate, scoped deviation, not drift.
export class DecisionReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;

  @IsInt()
  @Min(1)
  version!: number;
}
