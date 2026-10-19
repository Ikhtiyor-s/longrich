import { IsIn, IsNotEmpty, IsString, IsUUID } from 'class-validator';

// Invite-by-phone, not by user_id: phone is the only identifier a seller
// OWNER realistically knows about a staff candidate (the platform's whole
// identity model is phone+OTP — see auth.service.ts). This is a request-
// shape decision the TZ blueprint's one-line API list
// ("GET/POST /v1/seller/members") does not specify — flagged in this
// ticket's completion note as a guess, not silently assumed.
const SELLER_MEMBER_ROLES = ['OWNER', 'MANAGER', 'OPERATOR'] as const;

export class InviteMemberDto {
  @IsUUID()
  seller_id!: string;

  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsIn(SELLER_MEMBER_ROLES)
  role!: 'OWNER' | 'MANAGER' | 'OPERATOR';
}
