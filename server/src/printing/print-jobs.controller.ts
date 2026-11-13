import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { hasCapability, PrinterStatus, UserRole } from '@hardweb-pos/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FORBIDDEN_MESSAGE, RequestUser } from '../auth/user-view';
import {
  PRINT_JOB_FILTERS,
  PrintJobFilter,
  PrintJobView,
  StationPrintService,
} from './station-print.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Chek navbatini boshqarish: 'cashier' ruxsati yoki administrator / direktor / superadmin */
function assertCanManage(user: RequestUser | undefined): void {
  if (hasCapability(user, 'cashier') || user?.role === UserRole.Admin) return;
  throw new ForbiddenException(FORBIDDEN_MESSAGE);
}

function jobId(id: string): string {
  if (!UUID_RE.test(String(id ?? ''))) throw new NotFoundException('Chek topilmadi');
  return id;
}

// Bo'lim (oshxona/bar) cheklari navbati (B17) va printerlar holati (B26).
// Navbat amallari — kassir va boshqaruv; holat — tizimga kirgan har bir xodim (holat qatori).
@UseGuards(JwtAuthGuard)
@Controller('printing')
export class PrintJobsController {
  constructor(private readonly print: StationPrintService) {}

  // Bo'lim printerlari holati (yoqiq / javob bermayapti, navbatdagi cheklar soni)
  @Get('status')
  status(): Promise<PrinterStatus[]> {
    return this.print.getPrinterStatus();
  }

  // ?status=open (standart: chiqmagan — pending + expired) | pending | expired | printed | cancelled
  @Get('jobs')
  jobs(@Req() req: { user?: RequestUser }, @Query('status') status?: string): Promise<PrintJobView[]> {
    assertCanManage(req.user);
    const filter = (status ? String(status).trim() : 'open') as PrintJobFilter;
    if (!(PRINT_JOB_FILTERS as readonly string[]).includes(filter)) {
      throw new BadRequestException('Chek holati noto‘g‘ri');
    }
    return this.print.listJobs(filter);
  }

  // Hammasini hozir urinish — navbat ishchisi darhol ishga tushadi
  @Post('retry-all')
  @HttpCode(HttpStatus.OK)
  retryAll(@Req() req: { user?: RequestUser }) {
    assertCanManage(req.user);
    return this.print.retryAll();
  }

  // Bitta chekni hozir chiqarish (navbatdagi yoki muddati o'tgan)
  @Post('jobs/:id/retry')
  @HttpCode(HttpStatus.OK)
  retry(@Req() req: { user?: RequestUser }, @Param('id') id: string) {
    assertCanManage(req.user);
    return this.print.retryJob(jobId(id));
  }

  // Chekni bekor qilish (oshxonaga og'zaki aytilgan yoki qo'lda chiqarilgan)
  @Post('jobs/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Req() req: { user?: RequestUser }, @Param('id') id: string) {
    assertCanManage(req.user);
    return this.print.cancelJob(jobId(id));
  }
}
