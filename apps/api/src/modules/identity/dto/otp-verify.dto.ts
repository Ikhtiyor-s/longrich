import { IsUUID, Matches } from 'class-validator';

export class OtpVerifyDto {
  @IsUUID('4')
  challenge_id!: string;

  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code!: string;
}
