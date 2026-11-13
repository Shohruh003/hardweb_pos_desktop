import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Raw, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

import { UserEntity } from '../entities';
import { isFullAccessRole } from '@hardweb-pos/shared';
import { LoginThrottle } from './login-throttle';
import {
  BCRYPT_COST,
  safeCompare,
  SESSION_INVALID_MESSAGE,
  toSessionUser,
} from './user-view';

const WRONG_LOGIN_MESSAGE = 'Login yoki parol noto‘g‘ri';
const WRONG_PIN_MESSAGE = 'PIN noto‘g‘ri';

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');
  /** Login topilmaganda ham bcrypt ishlashi uchun soxta xesh (javob vaqti login borligini oshkor qilmasin) */
  private dummyHash: Promise<string> | null = null;

  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly jwt: JwtService,
    private readonly throttle: LoginThrottle,
  ) {}

  // Login + parol bilan kirish (Direktor/SuperAdmin uchun yagona yo'l)
  async login(login: string, password: string, ip: string) {
    // Urinish birinchi await'dan OLDIN (sinxron) sanaladi — bir vaqtda yuborilgan so'rovlar to'dasi
    // ham IP bo'yicha 5 tadan, umumiy 40 tadan ortiq parolni tekshirtira olmaydi
    const attempt = this.throttle.begin(ip, 'password');

    const name = (login ?? '').trim();
    // Login katta-kichik harfga sezgir emas; faqat faol foydalanuvchilar.
    // Eski bazalarda bir xil login takrorlangan bo'lishi mumkin — har birini tekshiramiz.
    const candidates = name
      ? await this.users.find({
          where: {
            login: Raw((alias) => `LOWER(${alias}) = LOWER(:login)`, {
              login: name,
            }),
            active: true,
          },
        })
      : [];

    let matched: UserEntity | null = null;
    for (const user of candidates) {
      // Paroli yo'q (yoki bo'sh xesh) foydalanuvchi login/parol bilan kira olmaydi
      if (!user.passwordHash) continue;
      if (await safeCompare(password ?? '', user.passwordHash)) {
        matched = user;
        break;
      }
    }

    if (!matched) {
      if (!candidates.some((u) => !!u.passwordHash)) {
        await safeCompare(password ?? '', await this.getDummyHash());
      }
      // Noto'g'ri urinish begin() da allaqachon sanalgan
      throw new UnauthorizedException(WRONG_LOGIN_MESSAGE);
    }

    this.throttle.succeed(attempt);
    return this.issue(matched);
  }

  // PIN orqali kirish — xodim faqat PIN kodini kiritadi
  async loginByPin(pin: string, ip: string) {
    this.throttle.assertAllowed(ip, 'pin');

    const code = (pin ?? '').trim();
    const user =
      code.length >= 4
        ? await this.users.findOne({ where: { pin: code, active: true } })
        : null;
    if (!user) {
      this.throttle.recordFailure(ip, 'pin');
      throw new UnauthorizedException(WRONG_PIN_MESSAGE);
    }
    // Direktor/SuperAdmin PIN bilan kira olmaydi — login+parol bilan kiradi
    // (tasodifiy 4 xonali raqam bilan rahbar kabinetiga kirib qolmasligi uchun).
    // Bu ham muvaffaqiyatsiz urinish sifatida sanaladi.
    if (isFullAccessRole(user.role)) {
      this.throttle.recordFailure(ip, 'pin');
      throw new UnauthorizedException(
        'Direktor login va parol bilan kiradi (PIN emas)',
      );
    }

    this.throttle.recordSuccess(ip);
    return this.issue(user);
  }

  // Joriy foydalanuvchi — bazadan yangi holatda (token ichidagi eski ma'lumot emas)
  async me(userId: string) {
    const user = await this.findActive(userId);
    return toSessionUser(user);
  }

  // O'z parolini almashtirish (joriy parol bilan tasdiqlanadi)
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ip: string,
  ) {
    // Joriy parolni tanlab topishga urinish ham cheklanadi — login kabi await'dan oldin sanaladi
    const attempt = this.throttle.begin(ip, 'password');

    let user: UserEntity;
    try {
      user = await this.findActive(userId);
    } catch (err) {
      this.throttle.release(attempt); // parol tekshirilmadi — urinish hisoblanmaydi
      throw err;
    }
    if (!user.passwordHash) {
      this.throttle.release(attempt);
      throw new BadRequestException('Bu foydalanuvchida parol yo‘q');
    }
    if (!(await safeCompare(currentPassword ?? '', user.passwordHash))) {
      // Noto'g'ri urinish begin() da allaqachon sanalgan
      throw new BadRequestException('Joriy parol noto‘g‘ri');
    }
    this.throttle.succeed(attempt);

    // Vaqtinchalik parolni o'zi bilan "almashtirib" majburiy almashtirishni chetlab o'tmaslik uchun
    if (newPassword === currentPassword) {
      throw new BadRequestException(
        'Yangi parol joriy paroldan farq qilishi kerak',
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    await this.users.update(user.id, {
      passwordHash,
      mustChangePassword: false,
    });
    user.passwordHash = passwordHash;
    user.mustChangePassword = false;
    this.logger.log(`Parol almashtirildi: ${user.name} (${user.role})`);
    return { ok: true, user: toSessionUser(user) };
  }

  private async findActive(userId: string): Promise<UserEntity> {
    const user = userId
      ? await this.users.findOne({ where: { id: userId } })
      : null;
    if (!user || !user.active) {
      throw new UnauthorizedException(SESSION_INVALID_MESSAGE);
    }
    return user;
  }

  private async issue(user: UserEntity) {
    // Javobdagi foydalanuvchi: Direktor/SuperAdmin — barcha ruxsatlar (toSessionUser ichida)
    const sessionUser = toSessionUser(user);
    // Payload'dagi rol/ruxsatlar faqat ma'lumot uchun: har so'rovda JwtStrategy
    // ularni bazadan qayta o'qiydi (bloklangan/o'zgargan xodim darhol ta'sirlanadi).
    const payload = {
      sub: user.id,
      role: user.role,
      name: user.name,
      permissions: sessionUser.permissions,
    };
    const token = await this.jwt.signAsync(payload);
    return { token, user: sessionUser };
  }

  private getDummyHash(): Promise<string> {
    if (!this.dummyHash) {
      this.dummyHash = bcrypt.hash(randomBytes(16).toString('hex'), BCRYPT_COST);
    }
    return this.dummyHash;
  }
}
