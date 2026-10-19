import { IsIn, IsOptional } from 'class-validator';

export class UpdateMeDto {
  @IsOptional()
  @IsIn(['uz', 'ru'])
  locale?: 'uz' | 'ru';
}
