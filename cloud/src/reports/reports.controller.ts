import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ReportPeriod } from '@hardweb-pos/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReportsService } from './reports.service';

function normalizePeriod(p?: string): ReportPeriod {
  return p === 'week' || p === 'month' ? p : 'day';
}

// Direktor hisobotlari — JWT tokendagi tenant bilan cheklangan (data isolation, TZ T-3.3)
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  summary(@Req() req: any, @Query('period') period?: string) {
    return this.reports.summary(req.user.tenantId, normalizePeriod(period));
  }

  @Get('top-items')
  topItems(@Req() req: any, @Query('period') period?: string) {
    return this.reports.topItems(req.user.tenantId, normalizePeriod(period));
  }

  @Get('waiters')
  waiters(@Req() req: any, @Query('period') period?: string) {
    return this.reports.waiterStats(req.user.tenantId, normalizePeriod(period));
  }
}
