import { BadRequestException, Controller, ForbiddenException, Get, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { FORBIDDEN_MESSAGE } from '../auth/user-view';
import { OrderType, ReportPeriod, UserRole } from '@hardweb-pos/shared';
import { Actor, can, isAdminRole } from '../orders/order-rules';
import { DebtStatus, DEBT_STATUS_MESSAGE, ReportsService, SHARE_PERCENT_MESSAGE, WAITER_REQUIRED_MESSAGE } from './reports.service';
import { resolveDay, resolveRange } from './report-dates';

/** ?from= yoki ?to= berilsa — aniq oraliq (sana yoki sana+vaqt), aks holda null (eski davr) */
function rangeOrNull(q: Record<string, unknown>) {
  return queryStr(q.from) || queryStr(q.to) ? resolveRange(q.from, q.to) : null;
}

function normalizePeriod(p?: string): ReportPeriod {
  return p === 'week' || p === 'month' ? p : 'day';
}

/** So'rov parametri (takrorlansa — birinchisi), bo'sh bo'lsa undefined */
function queryStr(v: unknown): string | undefined {
  const raw = Array.isArray(v) ? v[0] : v;
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim();
  return s ? s : undefined;
}

// ---- Ruxsatlar (rol emas — ruxsat; Direktor/SuperAdmin hammasiga ega) ----

/** Ofitsiantlar hisoboti (B20): administrator / direktor / superadmin yoki 'reports' ruxsati */
export function canSeeWaiterShares(u: Actor | null | undefined): boolean {
  return isAdminRole(u) || can(u, 'reports');
}

/** Otkazlar hisoboti (B19): hisobot ko'radiganlar va kassadagi tushumni ko'radigan kassir ('revenue') */
export function canSeeVoids(u: Actor | null | undefined): boolean {
  return canSeeWaiterShares(u) || can(u, 'revenue');
}

/** Kassa holati va qarzlar ro'yxati (B33/B34): kassir, hisobotchi yoki administrator / direktor */
export function canSeeCash(u: Actor | null | undefined): boolean {
  return isAdminRole(u) || can(u, 'cashier') || can(u, 'reports');
}

function assertAllowed(ok: boolean): void {
  if (!ok) throw new ForbiddenException(FORBIDDEN_MESSAGE);
}

// Eski hisobotlar (umumiy, top taomlar, ofitsiantlar, vozvrat, kunlik) — avvalgidek rollar bo'yicha
const LEGACY_ROLES = [UserRole.Director, UserRole.Admin, UserRole.Cashier, UserRole.SuperAdmin];

// Hisobotlar (TZ 5.5). Sinf darajasida rol cheklovi yo'q: eski marshrutlar @Roles bilan, yangilari
// (B19/B20/B33/B34) ruxsatlar (capabilities) bo'yicha tekshiriladi — masalan "my-share" ni xodim
// o'zi uchun ko'radi (ofitsiantdan tashqari — unga pul ko'rsatilmaydi).
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Roles(...LEGACY_ROLES)
  @Get('summary')
  summary(@Query() q: Record<string, unknown>) {
    return this.reports.summary(normalizePeriod(queryStr(q.period)), rangeOrNull(q));
  }

  @Roles(...LEGACY_ROLES)
  @Get('top-items')
  topItems(@Query() q: Record<string, unknown>) {
    return this.reports.topItems(normalizePeriod(queryStr(q.period)), 10, rangeOrNull(q));
  }

  @Roles(...LEGACY_ROLES)
  @Get('waiters')
  waiters(@Query() q: Record<string, unknown>) {
    return this.reports.waiterStats(normalizePeriod(queryStr(q.period)), rangeOrNull(q));
  }

  @Roles(...LEGACY_ROLES)
  @Get('refunds')
  refunds(@Query() q: Record<string, unknown>) {
    return this.reports.refunds(normalizePeriod(queryStr(q.period)), rangeOrNull(q));
  }

  // Barcha sotilgan taomlar (0.3.2): ?from=&to= (sana yoki sana+vaqt), ?type=stol|olib_ketish|yetkazish
  @Roles(...LEGACY_ROLES)
  @Get('items')
  items(@Query() q: Record<string, unknown>) {
    const t = queryStr(q.type);
    const type = t === 'stol' || t === 'olib_ketish' || t === 'yetkazish' ? (t as OrderType) : null;
    return this.reports.allItems(resolveRange(q.from, q.to), type);
  }

  @Roles(...LEGACY_ROLES)
  @Get('daily')
  daily(@Query('days') days?: string) {
    const n = Math.min(60, Math.max(1, Number(days) || 7));
    return this.reports.daily(n);
  }

  // ---- Ofitsiantlar hisoboti (B20) ----

  // ?from=YYYY-MM-DD&to=YYYY-MM-DD (mahalliy, ikkalasi kiradi; berilmasa — bugun) &sharePercent=
  // (berilmasa — sozlamadagi ofitsiant ulushi)
  @Get('waiter-shares')
  async waiterShares(@Query() q: Record<string, unknown>, @Request() req: any) {
    assertAllowed(canSeeWaiterShares(req?.user));
    const range = resolveRange(q.from, q.to);
    const raw = queryStr(q.sharePercent);
    let percent: number;
    if (raw === undefined) {
      percent = await this.reports.defaultSharePercent();
    } else {
      percent = Number(raw.replace(',', '.'));
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        throw new BadRequestException(SHARE_PERCENT_MESSAGE);
      }
    }
    return this.reports.waiterShares(range, percent);
  }

  // Shu xodim sotgan taomlar ("Taom" oynasi): ?waiterId=&from=&to=
  @Get('waiter-items')
  waiterItems(@Query() q: Record<string, unknown>, @Request() req: any) {
    assertAllowed(canSeeWaiterShares(req?.user));
    const waiterId = queryStr(q.waiterId);
    if (!waiterId) throw new BadRequestException(WAITER_REQUIRED_MESSAGE);
    return this.reports.waiterItems(waiterId, resolveRange(q.from, q.to));
  }

  // Xodimning o'z ko'rsatkichlari (faqat o'ziniki): ?date=YYYY-MM-DD. Ofitsiantga — yo'q: restoran
  // talabi bilan ofitsiant ekranida pul haqida hech narsa ko'rsatilmaydi (ulush ham)
  @Get('my-share')
  myShare(@Query('date') date: unknown, @Request() req: any) {
    const userId = req?.user?.id;
    assertAllowed(!!userId && req?.user?.role !== UserRole.Waiter);
    return this.reports.myShare(String(userId), resolveDay(date));
  }

  // ---- Otkazlar (B19) ----

  // ?from=&to= (mahalliy sanalar) yoki ?orderId= (bitta chekning otkazlari)
  @Get('voids')
  voids(@Query() q: Record<string, unknown>, @Request() req: any) {
    assertAllowed(canSeeVoids(req?.user));
    const orderId = queryStr(q.orderId);
    return this.reports.voids(resolveRange(q.from, q.to), orderId && orderId.length <= 64 ? orderId : undefined);
  }

  // ---- Kassa holati (B33) va qarzlar (B30/B34) ----

  @Get('cash-summary')
  cashSummary(@Query('date') date: unknown, @Request() req: any) {
    assertAllowed(canSeeCash(req?.user));
    return this.reports.cashSummary(resolveDay(date));
  }

  // ?status=open|repaid|all (standart: all — ochiqlari birinchi) &from=&to= (qarz yozilgan kun) &q=
  @Get('debts')
  debts(@Query() q: Record<string, unknown>, @Request() req: any) {
    assertAllowed(canSeeCash(req?.user));
    const raw = (queryStr(q.status) ?? 'all').toLowerCase();
    if (raw !== 'open' && raw !== 'repaid' && raw !== 'all') {
      throw new BadRequestException(DEBT_STATUS_MESSAGE);
    }
    const hasDates = queryStr(q.from) !== undefined || queryStr(q.to) !== undefined;
    return this.reports.debts(raw as DebtStatus, hasDates ? resolveRange(q.from, q.to) : null, queryStr(q.q));
  }
}
