import { Body, Controller, ForbiddenException, Param, Post, Request, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FORBIDDEN_MESSAGE } from '../auth/user-view';
import { can, isAdminRole } from '../orders/order-rules';
import { PAYMENT_METHOD_INVALID_MESSAGE, ReportsService } from './reports.service';

class RepayDebtDto {
  // Qaysi usul bilan qaytarildi: FAOL, qarz bo'lmagan to'lov usuli kaliti (naqd, karta, click…)
  @IsOptional()
  @IsString({ message: PAYMENT_METHOD_INVALID_MESSAGE })
  @MaxLength(32, { message: PAYMENT_METHOD_INVALID_MESSAGE })
  type?: string;
}

// Qarz qaytarish (B34): "Qarzga" yozilgan to'lov keyin to'lanadi. Kassir yoki administrator / direktor.
@UseGuards(JwtAuthGuard)
@Controller('debts')
export class DebtsController {
  constructor(private readonly reports: ReportsService) {}

  @Post(':paymentId/repay')
  repay(@Param('paymentId') paymentId: string, @Body() dto: RepayDebtDto, @Request() req: any) {
    if (!(can(req?.user, 'cashier') || isAdminRole(req?.user))) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }
    return this.reports.repayDebt(paymentId, dto?.type, req.user);
  }
}
