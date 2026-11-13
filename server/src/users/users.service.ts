import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Raw, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import {
  ALL_CAPABILITY_KEYS,
  defaultCapabilitiesForRole,
  isFullAccessRole,
  User,
  UserRole,
} from '@hardweb-pos/shared';

import { UserEntity } from '../entities';
import {
  BCRYPT_COST,
  FORBIDDEN_MESSAGE,
  RequestUser,
  safeCompare,
  toStaffRow,
} from '../auth/user-view';
import { CreateUserDto, isGiven, UpdateUserDto } from './dto';

const LAST_DIRECTOR_MESSAGE = 'Kamida bitta faol direktor qolishi kerak';
const CREDENTIALS_REQUIRED_MESSAGE =
  'Bu rol uchun login va parol majburiy (PIN bilan kira olmaydi)';
const PIN_TAKEN_ON_CREATE = 'Bu PIN band — boshqa 4 xonali kod tanlang';
const PIN_TAKEN_ON_UPDATE = 'Bu PIN band — boshqa kod tanlang';

const KNOWN_CAPABILITIES = new Set(ALL_CAPABILITY_KEYS);

/** Log uchun ustun nomlari (parol qiymati hech qachon yozilmaydi) */
const FIELD_LABELS: Record<string, string> = {
  name: 'ism',
  role: 'rol',
  active: 'faollik',
  permissions: 'ruxsatlar',
  pin: 'PIN',
  login: 'login',
  passwordHash: 'parol',
  mustChangePassword: 'parolni almashtirish talabi',
};

// Xodimlarni boshqarish qoidalari (ierarxiya):
//  • login/parolni faqat Direktor/SuperAdmin o'rnatadi;
//  • Direktor/SuperAdmin rolidagi xodimni (joriy yoki yangi roli) faqat Direktor/SuperAdmin
//    yaratadi, o'zgartiradi, o'chiradi; SuperAdmin xodimga faqat SuperAdmin tegina oladi;
//  • Administrator o'z rolini va ruxsatlarini o'zgartira olmaydi;
//  • kamida bitta faol Direktor doim qoladi; hech kim o'zini o'chira/bloklay olmaydi.
@Injectable()
export class UsersService {
  private readonly logger = new Logger('Users');

  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
  ) {}

  async findAll(): Promise<User[]> {
    const list = await this.users.find({ order: { name: 'ASC' } });
    // Parol xeshi hech qachon chiqmaydi; PIN ko'rsatiladi (admin xodimga aytadi)
    return list.map(toStaffRow);
  }

  async findWaiters() {
    const list = await this.users.find({
      where: { role: UserRole.Waiter, active: true },
      order: { name: 'ASC' },
    });
    return list.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      login: u.login,
      active: u.active,
    }));
  }

  async create(actor: RequestUser, dto: CreateUserDto): Promise<User> {
    const role = dto.role;
    const pin = isGiven(dto.pin) ? String(dto.pin) : null;
    const login = isGiven(dto.login) ? String(dto.login) : null;
    const password = isGiven(dto.password) ? String(dto.password) : null;

    // 1) Ruxsat (403)
    this.assertHierarchy(actor, null, role);
    if ((login || password) && !isFullAccessRole(actor.role)) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }

    // 2) Yangi xodim tizimga kira olishi shart (400)
    if (isFullAccessRole(role)) {
      if (!login || !password) {
        throw new BadRequestException(CREDENTIALS_REQUIRED_MESSAGE);
      }
    } else {
      if (login && !password) {
        throw new BadRequestException('Login uchun parol ham kiriting');
      }
      if (password && !login) {
        throw new BadRequestException('Parol uchun login ham kiriting');
      }
      if (!pin && !login) {
        throw new BadRequestException('PIN kiriting (4–10 ta raqam)');
      }
    }

    // 3) Unikallik
    if (pin) await this.assertPinFree(pin, null, PIN_TAKEN_ON_CREATE);
    if (login) await this.assertLoginFree(login, null);

    // Ruxsatlar berilmagan (yoki bo'sh) — rol bo'yicha standart ruxsatlar (ofitsiant -> zakaz,
    // oshpaz -> KDS, ...). Aks holda yangi xodim tizimga kirsa ham hech narsa qila olmaydi.
    // Direktor/SuperAdmin — barcha ruxsatlarga avtomatik ega, ro'yxat kerak emas.
    let permissions = normalizePermissions(dto.permissions);
    if (permissions.length === 0 && !isFullAccessRole(role)) {
      permissions = defaultCapabilitiesForRole(role);
    }

    const entity = this.users.create({
      name: dto.name,
      role,
      pin,
      login,
      passwordHash: password ? await bcrypt.hash(password, BCRYPT_COST) : null,
      // Parolni boshqa odam (direktor) qo'ydi — xodim birinchi kirishda o'zinikiga almashtiradi
      mustChangePassword: !!password,
      active: true,
      permissions,
    });
    const saved = await this.withPinConflict(
      () => this.users.save(entity),
      PIN_TAKEN_ON_CREATE,
    );
    this.logger.log(
      `Xodim qo‘shildi: ${saved.name} (${saved.role}) — ${actor.name}`,
    );
    return toStaffRow(saved);
  }

  async update(
    actor: RequestUser,
    id: string,
    dto: UpdateUserDto,
  ): Promise<User> {
    const target = await this.users.findOne({ where: { id } });
    if (!target) throw new NotFoundException('Xodim topilmadi');

    const actorFull = isFullAccessRole(actor.role);
    const isSelf = target.id === actor.id;

    // Nima o'zgaryapti? (UI o'zgarmagan maydonlarni ham yuboradi — faqat haqiqiy o'zgarishni hisoblaymiz)
    const nextRole = dto.role ?? target.role;
    const roleChanged = dto.role !== undefined && dto.role !== target.role;
    const deactivating = dto.active === false && target.active;

    const currentPermissions = normalizePermissions(target.permissions);
    const nextPermissions =
      dto.permissions !== undefined ? normalizePermissions(dto.permissions) : null;
    const permissionsChanged =
      nextPermissions !== null &&
      !samePermissions(nextPermissions, currentPermissions);

    const currentLogin = target.login ?? null;
    const loginGiven = dto.login !== undefined;
    const nextLogin = loginGiven
      ? isGiven(dto.login)
        ? String(dto.login)
        : null
      : currentLogin;
    const loginChanged = loginGiven && nextLogin !== currentLogin;
    const newPassword = isGiven(dto.password) ? String(dto.password) : null;

    const newPin = isGiven(dto.pin) ? String(dto.pin) : null;
    const pinChanged = newPin !== null && newPin !== target.pin;

    // 1) Ruxsat (403)
    this.assertHierarchy(actor, target, nextRole);
    if ((loginChanged || newPassword) && !actorFull) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }
    // Administrator o'ziga rol/ruxsat bera olmaydi (o'zini "ko'tarib" olmasligi uchun)
    if (isSelf && !actorFull && (roleChanged || permissionsChanged)) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }

    // 2) Kamida bitta faol direktor qolishi kerak (bloklash yoki rolini o'zgartirish)
    if (
      target.role === UserRole.Director &&
      target.active &&
      (deactivating || (roleChanged && nextRole !== UserRole.Director))
    ) {
      await this.assertNotLastDirector();
    }
    // O'zini bloklagan xodim tizimdan chiqib qoladi — bunga yo'l qo'ymaymiz
    if (isSelf && deactivating) {
      throw new BadRequestException('O‘zingizni bloklay olmaysiz');
    }

    // 3) Login va parol izchilligi
    let nextPasswordHash = target.passwordHash;
    let nextMustChange = !!target.mustChangePassword;
    if (loginChanged && nextLogin === null) {
      // Login olib tashlansa — parol bilan kirish ham yopiladi
      nextPasswordHash = null;
      nextMustChange = false;
    }
    if (newPassword) {
      if (!nextLogin) {
        throw new BadRequestException('Parol uchun login ham kiriting');
      }
      if (
        isSelf &&
        target.passwordHash &&
        (await safeCompare(newPassword, target.passwordHash))
      ) {
        throw new BadRequestException(
          'Yangi parol joriy paroldan farq qilishi kerak',
        );
      }
      nextPasswordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
      // Boshqa xodimga qo'yilgan parol vaqtinchalik — u keyingi kirishda almashtiradi.
      // O'z parolini o'zi qo'ysa — almashtirish shart emas.
      nextMustChange = !isSelf;
    } else if (loginChanged && nextLogin && !nextPasswordHash) {
      throw new BadRequestException('Login uchun parol ham kiriting');
    }
    // Direktor/SuperAdmin faqat login+parol bilan kiradi: rolga ko'tarilganda yoki
    // login olib tashlanganda kirish imkoni qolishi shart
    if (
      isFullAccessRole(nextRole) &&
      (roleChanged || loginChanged) &&
      (!nextLogin || !nextPasswordHash)
    ) {
      throw new BadRequestException(CREDENTIALS_REQUIRED_MESSAGE);
    }

    // 4) Unikallik
    if (pinChanged) await this.assertPinFree(newPin!, target.id, PIN_TAKEN_ON_UPDATE);
    if (loginChanged && nextLogin) await this.assertLoginFree(nextLogin, target.id);

    // 5) Saqlash — faqat o'zgargan ustunlar
    const patch: Partial<UserEntity> = {};
    if (dto.name !== undefined && dto.name !== target.name) patch.name = dto.name;
    if (roleChanged) patch.role = nextRole;
    if (dto.active !== undefined && dto.active !== target.active) {
      patch.active = dto.active;
    }
    if (permissionsChanged) patch.permissions = nextPermissions;
    if (pinChanged) patch.pin = newPin;
    if (loginChanged) patch.login = nextLogin;
    if (nextPasswordHash !== target.passwordHash) {
      patch.passwordHash = nextPasswordHash;
    }
    if (nextMustChange !== !!target.mustChangePassword) {
      patch.mustChangePassword = nextMustChange;
    }

    if (Object.keys(patch).length > 0) {
      await this.withPinConflict(
        () => this.users.update(target.id, patch),
        PIN_TAKEN_ON_UPDATE,
      );
      this.logger.log(
        `Xodim o‘zgartirildi: ${target.name} [${Object.keys(patch)
          .map((k) => FIELD_LABELS[k] ?? k)
          .join(', ')}] — ${actor.name}`,
      );
    }

    const updated = await this.users.findOne({ where: { id: target.id } });
    if (!updated) throw new NotFoundException('Xodim topilmadi');
    return toStaffRow(updated);
  }

  async remove(actor: RequestUser, id: string) {
    const target = await this.users.findOne({ where: { id } });
    // Allaqachon yo'q — natija baribir bir xil (takroriy bosish xato bermaydi)
    if (!target) return { ok: true };

    this.assertHierarchy(actor, target, target.role);
    if (target.role === UserRole.Director && target.active) {
      await this.assertNotLastDirector();
    }
    if (target.id === actor.id) {
      throw new BadRequestException('O‘zingizni o‘chira olmaysiz');
    }

    await this.users.delete(target.id);
    this.logger.log(
      `Xodim o‘chirildi: ${target.name} (${target.role}) — ${actor.name}`,
    );
    return { ok: true };
  }

  // ---- yordamchilar ----

  /**
   * Rol ierarxiyasi: xodimning joriy roli va so'ralgan yangi roli tekshiriladi.
   * SuperAdmin'ga faqat SuperAdmin; Direktor/SuperAdmin'ga faqat Direktor/SuperAdmin tegina oladi.
   */
  private assertHierarchy(
    actor: RequestUser,
    target: UserEntity | null,
    nextRole: string,
  ) {
    const touched = [nextRole, target?.role].filter(
      (r): r is string => !!r,
    );
    if (
      touched.includes(UserRole.SuperAdmin) &&
      actor.role !== UserRole.SuperAdmin
    ) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }
    if (touched.some(isFullAccessRole) && !isFullAccessRole(actor.role)) {
      throw new ForbiddenException(FORBIDDEN_MESSAGE);
    }
  }

  /** Faqat faol direktor ketayotganda chaqiriladi: u oxirgisi bo'lsa — 400 */
  private async assertNotLastDirector() {
    const activeDirectors = await this.users.count({
      where: { role: UserRole.Director, active: true },
    });
    if (activeDirectors <= 1) {
      throw new BadRequestException(LAST_DIRECTOR_MESSAGE);
    }
  }

  /** PIN unikal (bloklangan xodimlarniki ham band hisoblanadi) */
  private async assertPinFree(
    pin: string,
    exceptId: string | null,
    message: string,
  ) {
    const owner = await this.users.findOne({ where: { pin } });
    if (owner && owner.id !== exceptId) throw new BadRequestException(message);
  }

  /** Login katta-kichik harfdan qat'i nazar unikal */
  private async assertLoginFree(login: string, exceptId: string | null) {
    const owners = await this.users.find({
      where: {
        login: Raw((alias) => `LOWER(${alias}) = LOWER(:login)`, { login }),
      },
    });
    if (owners.some((u) => u.id !== exceptId)) {
      throw new BadRequestException('Bu login band');
    }
  }

  /** Bir vaqtda ikki so'rov bir PIN'ni olsa, DB UNIQUE xatosi 500 emas, tushunarli 400 bo'lsin */
  private async withPinConflict<T>(
    run: () => Promise<T>,
    message: string,
  ): Promise<T> {
    try {
      return await run();
    } catch (err: any) {
      const text = String(err?.message ?? '');
      if (text.includes('UNIQUE') && text.includes('users.pin')) {
        throw new BadRequestException(message);
      }
      throw err;
    }
  }
}

/** Faqat ma'lum ruxsat kalitlari, takrorlarsiz (tartib saqlanadi) */
function normalizePermissions(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const key of list) {
    if (typeof key === 'string' && KNOWN_CAPABILITIES.has(key) && !out.includes(key)) {
      out.push(key);
    }
  }
  return out;
}

function samePermissions(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((k) => set.has(k));
}
