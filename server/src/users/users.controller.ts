import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@hardweb-pos/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateUserDto, UpdateUserDto } from './dto';
import { UsersService } from './users.service';

// Xodimlarni boshqarish — admin, direktor va superadmin.
// Ierarxiya (kim kimni boshqaradi) UsersService ichida tekshiriladi:
// direktor admin va direktor yaratadi, admin — qolganlarni; login/parolni faqat direktor beradi.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Admin, UserRole.Director, UserRole.SuperAdmin)
@Controller('users')
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  // Ofitsiantlar ro'yxati — ofitsiant terminali kim ish boshlashini tanlash uchun.
  // Har qanday tizimga kirgan xodim ko'ra oladi (admin roli shart emas).
  @Roles(
    UserRole.Waiter,
    UserRole.Cook,
    UserRole.Cashier,
    UserRole.Admin,
    UserRole.Director,
    UserRole.SuperAdmin,
  )
  @Get('waiters')
  findWaiters() {
    return this.service.findWaiters();
  }

  @Post()
  create(@Body() dto: CreateUserDto, @Req() req: any) {
    return this.service.create(req.user, dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: any,
  ) {
    return this.service.update(req.user, id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(req.user, id);
  }
}
