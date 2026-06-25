import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { TableEntity } from '../entities';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@hardweb-pos/shared';

class TableDto {
  @IsInt() @Min(1) number: number;
  @IsString() hall: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
}

class TablePatchDto {
  @IsOptional() @IsInt() @Min(1) number?: number;
  @IsOptional() @IsString() hall?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
}

@UseGuards(JwtAuthGuard)
@Controller('tables')
export class TablesController {
  constructor(
    @InjectRepository(TableEntity)
    private readonly tables: Repository<TableEntity>,
  ) {}

  // Stollar ro'yxati va holati (TZ F-1.2)
  @Get()
  findAll() {
    return this.tables.find({ order: { hall: 'ASC', number: 'ASC' } });
  }

  // --- Boshqaruv (faqat admin) — TZ F-4.2 ---

  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin)
  @Post()
  create(@Body() dto: TableDto) {
    return this.tables.save(this.tables.create(dto));
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: TablePatchDto) {
    await this.tables.update(id, dto);
    return this.tables.findOne({ where: { id } });
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.tables.delete(id);
    return { ok: true };
  }
}
