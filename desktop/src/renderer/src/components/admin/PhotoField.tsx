import { useRef, useState } from 'react';
import { CameraIcon, TrashIcon } from '../cashier/icons';
import { DishThumb } from './DishThumb';
import { ImageFileError, dataUrlKb, firstFile, resizeImageFile } from './imageResize';

/**
 * Rasm o'zgarishi: undefined — o'zgarmadi (serverga yuborilmaydi), '' — o'chirish,
 * 'data:image/jpeg;base64,...' — yangi (kichraytirilgan) rasm.
 */
export type PhotoChange = string | undefined;

// Taom tahrirlash oynasidagi rasm maydoni: bosib tanlash yoki faylni sudrab tashlash,
// avtomatik kichraytirish (640 px, JPEG), oldindan ko'rish va "Rasmni o'chirish".
export function PhotoField({
  name,
  currentSrc,
  value,
  onChange,
  disabled,
}: {
  name: string;
  /** serverdagi joriy rasm (to'liq URL) */
  currentSrc?: string;
  value: PhotoChange;
  onChange: (v: PhotoChange) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const preview = value === undefined ? currentSrc : value || undefined;

  function pick() {
    if (!disabled && !busy) inputRef.current?.click();
  }

  async function take(file: File | null) {
    if (!file || disabled) return;
    setBusy(true);
    setError('');
    try {
      onChange(await resizeImageFile(file));
    } catch (e) {
      setError(e instanceof ImageFileError ? e.message : 'Rasmni qayta ishlab bo‘lmadi — boshqa rasm tanlang');
    } finally {
      setBusy(false);
      // Xuddi shu faylni qayta tanlash ham ishlasin
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label={preview ? 'Rasmni almashtirish' : 'Rasm tanlash'}
        onClick={pick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            pick();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          if (!drag) setDrag(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDrag(false);
          void take(firstFile(e.dataTransfer.files));
        }}
        className={`relative aspect-[4/3] rounded-xl border-2 border-dashed overflow-hidden cursor-pointer flex items-center justify-center transition-colors ${
          drag ? 'border-primary bg-primary/10' : 'border-border hover:border-primary bg-bg'
        } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        {preview ? (
          <DishThumb name={name || 'Taom'} src={preview} className="w-full h-full" emojiClass="text-6xl" />
        ) : (
          <div className="text-center text-muted px-4">
            <CameraIcon className="w-10 h-10 mx-auto mb-2" />
            <div className="font-bold text-text">Rasm tanlash</div>
            <div className="text-xs mt-1">yoki rasmni shu yerga sudrab tashlang · JPG, PNG, WEBP · 15 MB gacha</div>
          </div>
        )}
        {(busy || drag) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg/80 text-text font-bold">
            {busy ? (
              <>
                <span className="w-7 h-7 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                Rasm tayyorlanmoqda…
              </>
            ) : (
              'Qo‘yib yuboring'
            )}
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid="menu-photo-input"
        onChange={(e) => void take(firstFile(e.target.files))}
      />
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <button
          type="button"
          onClick={pick}
          disabled={disabled || busy}
          className="h-10 px-3 rounded-lg border border-border bg-bg text-sm font-semibold hover:border-primary inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          <CameraIcon className="w-4 h-4" /> {preview ? 'Almashtirish' : 'Rasm tanlash'}
        </button>
        {preview && (
          <button
            type="button"
            onClick={() => onChange(currentSrc ? '' : undefined)}
            disabled={disabled || busy}
            data-testid="menu-photo-remove"
            className="h-10 px-3 rounded-lg border border-danger/40 text-danger text-sm font-semibold hover:bg-danger/10 inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <TrashIcon className="w-4 h-4" /> Rasmni o‘chirish
          </button>
        )}
        {value ? (
          <span className="text-xs text-muted">Yangi rasm · {dataUrlKb(value)} KB</span>
        ) : value === '' ? (
          <span className="text-xs text-danger font-semibold">Saqlanganda rasm o‘chiriladi</span>
        ) : null}
      </div>
      {error && (
        <div role="alert" className="mt-2 bg-danger/10 border border-danger/40 text-danger rounded-lg px-3 py-2 text-sm font-semibold">
          {error}
        </div>
      )}
    </div>
  );
}
