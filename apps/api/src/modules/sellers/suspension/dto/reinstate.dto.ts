import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

// Unlike suspend, the ticket does not state reinstate requires a reason —
// kept optional so an admin can still attach one for the audit trail.
export class ReinstateDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason?: string;
}
