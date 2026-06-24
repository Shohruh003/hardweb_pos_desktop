import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@hardweb-pos/shared';

export const ROLES_KEY = 'roles';

// Endpointga ruxsat etilgan rollarni belgilash: @Roles(UserRole.Admin)
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
