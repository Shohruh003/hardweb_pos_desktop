import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TableEntity } from '../entities';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

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
}
