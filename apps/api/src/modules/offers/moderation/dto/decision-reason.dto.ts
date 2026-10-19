import { IsInt, IsNotEmpty, IsString, Min, MaxLength } from 'class-validator';

// Same `reason` shape as sellers/moderation's and catalog/moderation's own
// copies, plus `version` for the CAS reason explained in
// approve-decision.dto.ts — this module's own local copy, not shared.
export class DecisionReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;

  @IsInt()
  @Min(1)
  version!: number;
}
