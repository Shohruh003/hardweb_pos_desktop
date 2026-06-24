import { Controller, Get, Header } from '@nestjs/common';
import { DASHBOARD_HTML } from './dashboard.html';

// Direktor paneli sahifasi — bulut subdomeni ildizida (api prefiksisiz, main.ts da exclude)
@Controller('dashboard')
export class DashboardController {
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  page(): string {
    return DASHBOARD_HTML;
  }
}
