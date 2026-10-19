import { IsIn } from 'class-validator';

const SELLER_MEMBER_ROLES = ['OWNER', 'MANAGER', 'OPERATOR'] as const;

export class UpdateMemberRoleDto {
  @IsIn(SELLER_MEMBER_ROLES)
  role!: 'OWNER' | 'MANAGER' | 'OPERATOR';
}
