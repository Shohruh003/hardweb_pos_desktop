import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ReportPeriod, UserRole } from '@hardweb-pos/shared';
import { ReportsService } from './reports.service';

function normalizePeriod(p?: string): ReportPeriod {
  return p === 'week' || p === 'month' ? p : 'day';
}

// Hisobotlar — Direktor, Administrator va Kassir (kunlik tushum) ko'radi (TZ 5.5)
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Director, UserRole.Admin, UserRole.Cashier)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  summary(@Query('period') period?: string) {
    return this.reports.summary(normalizePeriod(period));
  }

  @Get('top-items')
  topItems(@Query('period') period?: string) {
    return this.reports.topItems(normalizePeriod(period));
  }

  @Get('waiters')
  waiters(@Query('period') period?: string) {
    return this.reports.waiterStats(normalizePeriod(period));
  }
}
