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
import { IsOptional, IsString } from 'class-validator';
import { TerminalEntity } from '../entities';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@hardweb-pos/shared';

class TerminalDto {
  @IsString() name: string;
  @IsOptional() @IsString() hall?: string;
  @IsOptional() @IsString() note?: string;
}

// Terminallar (bloklar) — Admin/Direktor/SuperAdmin boshqaradi
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Admin, UserRole.Director, UserRole.SuperAdmin)
@Controller('terminals')
export class TerminalsController {
  constructor(
    @InjectRepository(TerminalEntity)
    private readonly terminals: Repository<TerminalEntity>,
  ) {}

  @Get()
  findAll() {
    return this.terminals.find({ order: { createdAt: 'ASC' } });
  }

  @Post()
  create(@Body() dto: TerminalDto) {
    return this.terminals.save(
      this.terminals.create({ name: dto.name, hall: dto.hall ?? null, note: dto.note ?? null }),
    );
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: TerminalDto) {
    await this.terminals.update(id, {
      name: dto.name,
      hall: dto.hall ?? null,
      note: dto.note ?? null,
    });
    return this.terminals.findOne({ where: { id } });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.terminals.delete(id);
    return { ok: true };
  }
}
