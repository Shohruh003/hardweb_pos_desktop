import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CategoryEntity,
  MenuItemEntity,
  OrderEntity,
  OrderItemEntity,
  PaymentEntity,
  ProductEntity,
  RecipeItemEntity,
  StationEntity,
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
      OrderEntity,
      OrderItemEntity,
      PaymentEntity,
      ProductEntity,
      RecipeItemEntity,
      StationEntity,
    ]),
  ],
  providers: [SeedService],
})
export class SeedModule {}
