import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { SyncPayload } from '@hardweb-pos/shared';
import { ApiKeyGuard } from '../common/api-key.guard';
import { SyncService } from './sync.service';

// Lokal server bu yerga yopilgan hisoblarni yuboradi (TZ 2.2 / 5-bosqich)
@UseGuards(ApiKeyGuard)
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post()
  ingest(@Req() req: any, @Body() payload: SyncPayload) {
    return this.sync.ingest(req.tenant.id, payload);
  }
}
