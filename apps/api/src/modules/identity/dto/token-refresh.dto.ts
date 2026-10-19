import { IsNotEmpty, IsString } from 'class-validator';

export class TokenRefreshDto {
  @IsString()
  @IsNotEmpty()
  refresh_token!: string;
}
