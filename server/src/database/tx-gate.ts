import { Logger } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { EntityManager } from 'typeorm';
import { BetterSqlite3QueryRunner } from 'typeorm/driver/better-sqlite3/BetterSqlite3QueryRunner';

/**
 * SQLite tranzaksiyalari navbati (0.3.3).
 *
 * TypeORM better-sqlite3 drayveri BITTA umumiy ulanish (QueryRunner) ishlatadi va tranzaksiyalarni
 * ichma-ich (SAVEPOINT) qiladi. Shuning uchun bir vaqtda boshlangan ikkita dataSource.transaction()
 * (masalan buyurtma saqlanayotganda printer navbatiga yozish) bir-birining ichiga tushardi: birining
 * xatosi (ROLLBACK) ikkinchisining o'zgarishini bekor qilishi, bekor bo'lishi kerak bo'lgan o'zgarish
 * esa saqlanib qolishi mumkin edi. Tranzaksiya ochiq turganda boshqa oqimning oddiy so'rovlari ham
 * o'sha tranzaksiyaga qo'shilib, u bilan birga bekor bo'lardi.
 *
 * Yechim:
 *  - tranzaksiyalar navbat bilan (bittasi tugamaguncha boshqasi boshlanmaydi);
 *  - tranzaksiya ochiq turganda BOSHQA oqimlarning so'rovlari uning tugashini kutadi;
 *  - shu tranzaksiya ichidagi chaqiruvlar (ichma-ich transaction, uning so'rovlari) kutmaydi —
 *    "kimning tranzaksiyasi" AsyncLocalStorage orqali aniqlanadi.
 * Kutish chegaralangan: kutilmagan bog'liqlikda ham dastur qotib qolmaydi — ogohlantirish yoziladi
 * va eski usulda (navbatsiz) davom etiladi.
 */

const logger = new Logger('TxGate');
const als = new AsyncLocalStorage<symbol>();

/** Hozir ochiq (navbatdan o'tgan) tranzaksiyalar; odatda bittadan ko'p bo'lmaydi */
const active = new Set<symbol>();
let waiters: Array<() => void> = [];

/** Oddiy so'rov boshqa oqimning tranzaksiyasini shuncha kutadi */
export const QUERY_WAIT_MS = 5_000;
/** Yangi tranzaksiya navbatni shuncha kutadi */
export const TX_WAIT_MS = 15_000;
/** TypeORM'ning o'zi ochgan (save) tranzaksiyasi tugashini tekshirish oralig'i */
const POLL_MS = 2;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function wakeAll(): void {
  const list = waiters;
  waiters = [];
  for (const wake of list) wake();
}

/** Navbat o'zgarishini (yoki `ms` o'tishini) kutish */
function waitTurn(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, Math.max(1, ms));
    waiters.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Joriy oqim — ochiq tranzaksiyalardan birining egasimi */
function ownsGate(): boolean {
  const store = als.getStore();
  return !!store && active.has(store);
}

/** Umumiy ulanishda TypeORM o'zi ochgan (masalan save()) tranzaksiya hali tugamaganmi */
function sharedTxActive(manager: EntityManager): boolean {
  type Runner = { isTransactionActive?: boolean };
  const own = (manager as unknown as { queryRunner?: Runner }).queryRunner;
  const shared = (manager.connection?.driver as unknown as { queryRunner?: Runner } | undefined)?.queryRunner;
  return !!(own ?? shared)?.isTransactionActive;
}

/** Test va diagnostika uchun: navbat holati */
export function txGateState(): { active: number; waiting: number } {
  return { active: active.size, waiting: waiters.length };
}

let installed = false;

/** Bir marta, server modullari yaratilishidan OLDIN chaqiriladi (main.ts) */
export function installTransactionGate(): void {
  if (installed) return;
  installed = true;

  type TxFn = (this: EntityManager, ...args: unknown[]) => Promise<unknown>;
  const managerProto = EntityManager.prototype as unknown as { transaction: TxFn };
  const originalTransaction = managerProto.transaction;

  managerProto.transaction = async function gatedTransaction(this: EntityManager, ...args: unknown[]) {
    // Shu tranzaksiya ichidan ichma-ich chaqiruv — TypeORM o'zi SAVEPOINT qiladi, navbat kerak emas
    if (ownsGate()) return originalTransaction.apply(this, args);

    const token = Symbol('tx');
    return als.run(token, async () => {
      const deadline = Date.now() + TX_WAIT_MS;
      while (active.size > 0 || sharedTxActive(this)) {
        const left = deadline - Date.now();
        if (left <= 0) {
          logger.warn(`Tranzaksiya navbati ${TX_WAIT_MS} ms dan ortiq kutildi — navbatsiz davom etiladi`);
          break;
        }
        if (active.size > 0) await waitTurn(left);
        else await sleep(POLL_MS);
      }
      active.add(token);
      try {
        return await originalTransaction.apply(this, args);
      } finally {
        active.delete(token);
        wakeAll();
      }
    });
  };

  type QueryFn = (this: unknown, ...args: unknown[]) => Promise<unknown>;
  const runnerProto = BetterSqlite3QueryRunner.prototype as unknown as { query: QueryFn };
  const originalQuery = runnerProto.query;

  runnerProto.query = async function gatedQuery(this: unknown, ...args: unknown[]) {
    if (active.size > 0 && !ownsGate()) {
      const deadline = Date.now() + QUERY_WAIT_MS;
      while (active.size > 0 && !ownsGate()) {
        const left = deadline - Date.now();
        if (left <= 0) {
          logger.warn(`So‘rov tranzaksiya tugashini ${QUERY_WAIT_MS} ms dan ortiq kutdi — navbatsiz bajarildi`);
          break;
        }
        await waitTurn(left);
      }
    }
    return originalQuery.apply(this, args);
  };
}
