import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TerminalEntity } from '../entities';
import { TerminalsController } from './terminals.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TerminalEntity])],
  controllers: [TerminalsController],
})
export class TerminalsModule {}
