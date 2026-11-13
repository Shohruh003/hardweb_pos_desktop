import React, { useEffect, useRef, useState } from 'react';
import type { User } from '@hardweb-pos/shared';
import { Modal } from './Modal';
import { Button } from './ui';
import { FeedbackModal } from './FeedbackModal';
import { api } from '../lib/api';
import { useAuth } from '../state/auth';

export interface ChangePasswordModalProps {
  /** true — yopib bo'lmaydi (birinchi kirishda parolni almashtirish majburiy) */
  forced?: boolean;
  /** Oddiy rejimda yopish */
  onClose?: () => void;
  /** Muvaffaqiyatli almashtirilgach — serverdan kelgan yangilangan foydalanuvchi */
  onChanged?: (user: User) => void;
}

// Server bilan bir xil chegaralar (POST /auth/change-password)
const PASSWORD_MIN = 4;
const PASSWORD_MAX = 64;

interface ChangePasswordResponse {
  ok: boolean;
  user?: User;
}

/** Mijoz tomonidagi tekshiruv — server matnlari bilan bir xil (birinchi xato yoki null) */
function validate(current: string, next: string, repeat: string): string | null {
  if (!current) return 'Joriy parolni kiriting';
  if (!next) return 'Yangi parolni kiriting';
  if (next.length < PASSWORD_MIN) return 'Yangi parol kamida 4 ta belgidan iborat bo‘lishi kerak';
  if (next.length > PASSWORD_MAX) return 'Yangi parol 64 ta belgidan oshmasligi kerak';
  if (next !== repeat) return 'Yangi parollar bir xil emas — qaytadan tekshiring';
  if (next === current) return 'Yangi parol joriy paroldan farq qilishi kerak';
  return null;
}

// Parolni almashtirish oynasi.
//  • oddiy rejim (foydalanuvchi menyusidan) — yopish (✕, fon) mumkin;
//  • majburiy rejim (vaqtinchalik parol bilan kirilganda) — yopib bo'lmaydi; App o'zining
//    "⎋ Chiqish" tugmasini z-[100] da ko'rsatadi, shuning uchun bu oyna z-50 da qoladi.
// Muvaffaqiyatdan keyin avval tasdiq ko'rsatiladi, "OK" bosilganda onChanged chaqiriladi
// (majburiy rejimda App shu zahoti bu oynani yopadi — tasdiq ko'rinmay qolmasligi uchun).
export default function ChangePasswordModal({ forced, onClose, onChanged }: ChangePasswordModalProps) {
  const { user: me } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState<User | null>(null);

  // PIN bilan kiradigan xodimda parol yo'q — unga parol almashtirish majburlanmaydi (server qoidasi):
  // talab olib tashlanadi va ilova odatdagidek ochiladi. Bir marta chaqiriladi.
  const pinOnly = !!forced && !!me && me.hasPassword === false;
  const skipped = useRef(false);
  useEffect(() => {
    if (!pinOnly || skipped.current || !me) return;
    skipped.current = true;
    onChanged?.({ ...me, mustChangePassword: false });
  }, [pinOnly, me, onChanged]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (saving) return;
    const problem = validate(current, next, repeat);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await api.post<ChangePasswordResponse>('/auth/change-password', {
        currentPassword: current,
        newPassword: next,
      });
      // Server yangilangan foydalanuvchini qaytaradi; bo'lmasa — joriy foydalanuvchidan tiklaymiz
      const user = res?.user ?? (me ? { ...me, hasPassword: true, mustChangePassword: false } : null);
      if (!user) throw new Error('Parol o‘zgardi, lekin javob noto‘g‘ri — qayta kiring');
      setChanged(user);
      setCurrent('');
      setNext('');
      setRepeat('');
    } catch (err) {
      setError((err as Error)?.message || 'Parolni o‘zgartirib bo‘lmadi');
    } finally {
      setSaving(false);
    }
  }

  function finish() {
    if (!changed) return;
    onChanged?.(changed);
    if (!forced) onClose?.();
  }

  if (pinOnly) return null;

  // Muvaffaqiyat — jonli tasdiq (confetti). OK bosilganda davom etamiz.
  if (changed) {
    return (
      <FeedbackModal
        variant="success"
        title="Parol o‘zgartirildi"
        subtitle="Endi tizimga yangi parol bilan kirasiz"
        onClose={finish}
      />
    );
  }

  const mismatch = repeat.length > 0 && next !== repeat;
  const form = (
    <form onSubmit={submit} noValidate>
      {forced && (
        <div className="bg-warning/10 border border-warning/40 rounded-xl p-3.5 mb-4 text-sm text-text leading-relaxed">
          Siz <b>vaqtinchalik parol</b> bilan kirdingiz (uni boshqa odam o‘rnatgan). Davom etish uchun uni faqat
          o‘zingiz biladigan yangi parolga almashtiring.
        </div>
      )}

      <PasswordField
        label="Joriy parol"
        value={current}
        onChange={(v) => {
          setCurrent(v);
          setError('');
        }}
        show={show}
        autoFocus
        autoComplete="current-password"
        placeholder={forced ? 'Sizga berilgan vaqtinchalik parol' : 'Hozirgi parolingiz'}
      />
      <PasswordField
        label="Yangi parol"
        value={next}
        onChange={(v) => {
          setNext(v);
          setError('');
        }}
        show={show}
        autoComplete="new-password"
        placeholder="4–64 ta belgi"
        maxLength={PASSWORD_MAX}
      />
      <PasswordField
        label="Yangi parolni takrorlang"
        value={repeat}
        onChange={(v) => {
          setRepeat(v);
          setError('');
        }}
        show={show}
        autoComplete="new-password"
        placeholder="Yangi parolni qayta yozing"
        maxLength={PASSWORD_MAX}
        invalid={mismatch}
      />

      <div className="flex items-center justify-between gap-3 -mt-1 mb-3 min-h-[24px]">
        <span className={`text-sm font-semibold ${mismatch ? 'text-danger' : 'text-success'}`}>
          {repeat.length > 0 ? (mismatch ? '✕ Parollar mos emas' : '✓ Parollar mos') : ''}
        </span>
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="shrink-0 px-3 h-10 rounded-lg border border-border text-sm font-semibold text-text hover:border-primary"
        >
          {show ? '🙈 Yashirish' : '👁 Ko‘rsatish'}
        </button>
      </div>

      <div className="text-xs text-muted mb-3">
        Yangi parol 4–64 ta belgi. Uni hech kimga aytmang va yozib qo‘ysangiz — xavfsiz joyda saqlang.
      </div>

      {error && (
        <div
          role="alert"
          className="mb-3 bg-danger/10 border border-danger/50 text-danger rounded-xl px-3.5 py-2.5 text-sm font-semibold"
        >
          ⚠️ {error}
        </div>
      )}

      <div className="flex gap-2">
        {!forced && (
          <Button type="button" variant="ghost" className="flex-1 py-3" onClick={onClose} disabled={saving}>
            Bekor qilish
          </Button>
        )}
        <Button type="submit" className="flex-1 py-3 text-lg" disabled={saving}>
          {saving ? 'Saqlanmoqda…' : forced ? 'Parolni saqlash va davom etish' : 'Saqlash'}
        </Button>
      </div>
    </form>
  );

  if (!forced) {
    return (
      <Modal title="🔑 Parolni o‘zgartirish" onClose={() => !saving && onClose?.()}>
        {form}
      </Modal>
    );
  }

  // Majburiy rejim: ✕ yo'q, fon bosilganda yopilmaydi
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-overlay-in p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="bg-surface border border-border rounded-2xl w-full max-w-[460px] max-h-[92vh] overflow-auto animate-pop-in shadow-2xl"
      >
        <div className="px-5 pt-5 pb-3 border-b border-border flex items-center gap-3">
          <span className="w-12 h-12 shrink-0 rounded-full bg-primary/15 text-primary flex items-center justify-center text-2xl">
            🔐
          </span>
          <div className="min-w-0">
            <div className="text-lg font-extrabold leading-tight">Xavfsizlik uchun yangi parol o‘rnating</div>
            {me?.name && <div className="text-sm text-muted truncate">{me.name}</div>}
          </div>
        </div>
        <div className="p-5">{form}</div>
      </div>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  show,
  autoFocus,
  autoComplete,
  placeholder,
  maxLength,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  autoFocus?: boolean;
  autoComplete: string;
  placeholder?: string;
  maxLength?: number;
  invalid?: boolean;
}) {
  return (
    <label className="block mb-3">
      <span className="block text-sm font-semibold text-text mb-1.5">{label}</span>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder}
        maxLength={maxLength}
        className={`w-full px-4 py-3 rounded-xl bg-bg border-2 text-lg text-text outline-none transition-colors ${
          invalid ? 'border-danger' : 'border-border focus:border-primary'
        }`}
      />
    </label>
  );
}
