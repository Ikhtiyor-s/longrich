import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Reason is required (ticket's own "done means" criteria) but sellers has no
// reason column (ticket: "Migration: None") — it is carried in the audit log
// and the seller.suspended.v1 outbox payload instead of a new DB column.
export class SuspendDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;
}
