import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// REJECT requires a non-empty reason (ticket's own "done means" criteria).
// Deliberate duplicate of sellers/moderation's DecisionReasonDto — each
// module owns its own DTO copy, per api-contract-g2.md's G2 file structure
// note ("three ~10-line files, not a maintenance burden worth violating
// module independence for").
export class DecisionReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;
}
