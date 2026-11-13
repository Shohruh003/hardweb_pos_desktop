import { memo, useState } from 'react';
import { emojiFor, tileClass } from '../../lib/menuImages';

// Taomning kichik rasmi (admin ro'yxati / tahrirlash oynasi). Rasm "lazy" yuklanadi — 149 ta
// taomli ro'yxat ochilganda faqat ekranda ko'ringanlari so'raladi. Rasm yo'q yoki yuklanmasa —
// ofitsiant menyusidagi kabi rangli plitka + emoji.
function DishThumbImpl({
  name,
  src,
  className = 'w-14 h-14 rounded-xl',
  emojiClass = 'text-2xl',
}: {
  name: string;
  /** to'liq URL (assetUrl) yoki data URL; bo'lmasa — plitka */
  src?: string | null;
  className?: string;
  emojiClass?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const show = src && src !== failedSrc ? src : null;
  if (show) {
    return (
      <div className={`overflow-hidden bg-bg shrink-0 ${className}`}>
        <img
          src={show}
          alt={name}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailedSrc(show)}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }
  return (
    <div className={`shrink-0 flex items-center justify-center ${tileClass(name)} ${className}`} aria-hidden>
      <span className={`drop-shadow select-none ${emojiClass}`}>{emojiFor(name)}</span>
    </div>
  );
}

export const DishThumb = memo(DishThumbImpl);
