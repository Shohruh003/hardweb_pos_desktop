import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CategoryEntity,
  MenuItemEntity,
  TableEntity,
  UserEntity,
} from '../entities';
import { SeedService } from './seed.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      TableEntity,
      CategoryEntity,
      MenuItemEntity,
    ]),
  ],
  providers: [SeedService],
})
export class SeedModule {}
