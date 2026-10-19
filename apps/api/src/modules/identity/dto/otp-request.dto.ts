import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class OtpRequestDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsIn(['LOGIN'])
  purpose!: string;
}
