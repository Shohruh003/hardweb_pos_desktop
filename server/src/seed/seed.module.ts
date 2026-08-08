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
    ]),
  ],
  providers: [SeedService],
})
export class SeedModule {}
