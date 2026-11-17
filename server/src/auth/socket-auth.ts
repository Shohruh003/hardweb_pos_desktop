import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource, Repository } from 'typeorm';

import { SettingsEntity, UserEntity } from '../entities';
import { DirectorAccess } from './director-access';
import { effectivePermissions, jwtSecret, RequestUser } from './user-view';

// ---- Socket.IO xonalari (OrdersGateway ulanishda belgilaydi; hodisa yuboradigan har gateway shularni ishlatadi) ----

/**
 * Xodimlar xonasi: tokeni tekshirilgan ulanishlar. Buyurtma, chek va printer hodisalari FAQAT shu
 * xonaga yuboriladi — ularda mijoz telefoni/manzili, summalar va cheklar bor.
 */
export const STAFF_ROOM = 'staff';
/** Ochiq xona: tokensiz yoki tokeni yaroqsiz ulanishlar (navbat tablosi TV, login ekrani) */
export const PUBLIC_ROOM = 'public';
/**
 * Ochiq xonaga yuboriladigan YAGONA hodisa — yuksiz signal "navbat o'zgardi" (shaxsiy ma'lumot ham,
 * summa ham yo'q). Navbat tablosi (/queue) shu signalda ro'yxatni GET /queue/data dan qayta o'qiydi.
 */
export const QUEUE_CHANGED_EVENT = 'queue:changed';

/** Oddiy token ~300 belgi — bundan uzuni tekshirilmaydi (bema'ni katta qiymat CPU'ni band qilmasin) */
const MAX_TOKEN_LENGTH = 4096;

/**
 * Socket.IO ulanishidagi token: handshake.auth.token (socket.io-client `auth` opsiyasi),
 * bo'lmasa ?token= so'rov parametri. "Bearer " old qo'shimchasi ham qabul qilinadi. Yo'q — null.
 */
export function socketTokenOf(handshake: { auth?: unknown; query?: unknown } | null | undefined): string | null {
  const fromAuth = (handshake?.auth as { token?: unknown } | null | undefined)?.token;
  const fromQuery = (handshake?.query as { token?: unknown } | null | undefined)?.token;
  const raw =
    typeof fromAuth === 'string' && fromAuth.trim()
      ? fromAuth
      : Array.isArray(fromQuery)
        ? fromQuery[0]
        : fromQuery;
  if (typeof raw !== 'string') return null;
  const token = raw.trim().replace(/^Bearer\s+/i, '');
  return token || null;
}

/**
 * Socket.IO ulanishi tokenini tekshirish — HTTP so'rovlardagi JwtStrategy bilan AYNAN bir xil qoida:
 * imzo va muddat (o'sha JWT_SECRET), xodim bazada bor va faol (bloklangan/o'chirilgan xodimning eski
 * tokeni o'tmaydi), direktor/SuperAdmin tokeni faqat server kompyuteridan (B35, sozlama yoqilganda).
 *
 * OrdersModule'ning importlarini o'zgartirmaslik uchun DI'siz quriladi: faqat global ConfigService va
 * DataSource kerak. Hech qachon throw qilmaydi va tokenni jurnalga YOZMAYDI.
 */
export class SocketAuth {
  private readonly jwt: JwtService;
  private readonly users: Repository<UserEntity>;
  private readonly directorAccess: DirectorAccess;

  constructor(config: ConfigService, dataSource: DataSource) {
    this.jwt = new JwtService({ secret: jwtSecret(config) });
    this.users = dataSource.getRepository(UserEntity);
    this.directorAccess = new DirectorAccess(dataSource.getRepository(SettingsEntity));
  }

  /** Yaroqli token -> xodim ({ id, role, name, permissions }); yo'q / yaroqsiz / muddati o'tgan -> null */
  async verify(token: string | null | undefined, address: unknown): Promise<RequestUser | null> {
    if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH) return null;
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: unknown }>(token);
      const id = typeof payload?.sub === 'string' ? payload.sub : '';
      if (!id) return null;
      const user = await this.users.findOne({ where: { id } });
      if (!user || !user.active) return null;
      if (await this.directorAccess.isBlocked(user.role, address)) return null;
      return {
        id: user.id,
        role: user.role,
        name: user.name,
        permissions: effectivePermissions(user),
      };
    } catch {
      // Imzo noto'g'ri, muddati o'tgan yoki baza band — ulanish ochiq (xodimsiz) bo'lib qoladi
      return null;
    }
  }
}
