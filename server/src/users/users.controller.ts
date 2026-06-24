import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { UserEntity } from '../entities';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@hardweb-pos/shared';

class CreateUserDto {
  @IsString() name: string;
  @IsString() login: string;
  @IsEnum(UserRole) role: UserRole;
  @IsString() @MinLength(3) password: string;
}

class UpdateUserDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MinLength(3) password?: string;
}

// Xodimlarni boshqarish — faqat admin (TZ F-4.3)
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Admin)
@Controller('users')
export class UsersController {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
  ) {}

  @Get()
  async findAll() {
    const list = await this.users.find({ order: { name: 'ASC' } });
    // parol_hash mijozga yuborilmaydi
    return list.map(({ passwordHash, ...rest }) => rest);
  }

  // Ofitsiantlar ro'yxati — ofitsiant terminali kim ish boshlashini tanlash uchun.
  // Har qanday tizimga kirgan foydalanuvchi ko'ra oladi (admin roli shart emas).
  @Roles(
    UserRole.Waiter,
    UserRole.Cook,
    UserRole.Cashier,
    UserRole.Admin,
    UserRole.Director,
  )
  @Get('waiters')
  async findWaiters() {
    const list = await this.users.find({
      where: { role: UserRole.Waiter, active: true },
      order: { name: 'ASC' },
    });
    return list.map((u) => ({ id: u.id, name: u.name, role: u.role, login: u.login, active: u.active }));
  }

  @Post()
  async create(@Body() dto: CreateUserDto) {
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const saved = await this.users.save(
      this.users.create({
        name: dto.name,
        login: dto.login,
        role: dto.role,
        passwordHash,
        active: true,
      }),
    );
    const { passwordHash: _, ...rest } = saved;
    return rest;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    const patch: Partial<UserEntity> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.role !== undefined) patch.role = dto.role;
    if (dto.active !== undefined) patch.active = dto.active;
    if (dto.password) patch.passwordHash = await bcrypt.hash(dto.password, 10);
    await this.users.update(id, patch);
    const updated = await this.users.findOne({ where: { id } });
    if (!updated) return null;
    const { passwordHash, ...rest } = updated;
    return rest;
  }
}
