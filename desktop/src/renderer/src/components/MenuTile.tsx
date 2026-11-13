import { memo, useMemo, useState } from 'react';
import { assetUrl } from '../lib/api';
import { emojiFor, getMenuImage, tileClass } from '../lib/menuImages';

interface TileState {
  key: string; // manbalar ro'yxati (o'zgarsa — holat qaytadan)
  idx: number; // hozir sinalayotgan manba
}

/**
 * Taom rasmi yoki yorqin emoji-plitka (rasm bo'lmasa / yuklanmasa).
 * Rasm manbalari tartib bilan sinaladi: serverdagi rasm (imageUrl — '/api/menu/items/<id>/image?v=N',
 * server manziliga aylantiriladi; versiya o'zgarmaguncha brauzer keshidan olinadi) -> image (admin
 * tahrirlash oynasidagi data URL) -> ilova ichidagi standart rasm (assets/menu). Rasm yuklanmasa
 * (onError) — keyingisi, oxiri — emoji plitka.
 * Rasm "lazy" yuklanadi: ekranda ko'rinmaguncha tarmoqdan so'ralmaydi (149 taomli menyu tez ochiladi).
 */
function MenuTileImpl({
  name,
  image,
  imageUrl,
  imageKey,
  className = '',
}: {
  name: string;
  /** data URL (faqat tahrirlash oynasida) yoki to'liq URL */
  image?: string | null;
  /** serverdagi rasm manzili (MenuItem.imageUrl) */
  imageUrl?: string | null;
  imageKey?: string;
  /** o'lcham/burchak sinflari (standart: 4:3, rounded-xl) */
  className?: string;
}) {
  const sources = useMemo(() => {
    const list = [assetUrl(imageUrl), assetUrl(image), getMenuImage(name, imageKey)].filter((s): s is string => !!s);
    return Array.from(new Set(list));
  }, [imageUrl, image, name, imageKey]);
  const key = sources.join('|');
  const [state, setState] = useState<TileState>({ key, idx: 0 });
  const idx = state.key === key ? state.idx : 0;
  const src = sources[idx];
  const box = className || 'aspect-[4/3] rounded-xl';

  if (src) {
    return (
      <div className={`overflow-hidden bg-bg ${box}`}>
        <img
          src={src}
          alt={name}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setState({ key, idx: idx + 1 })}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      </div>
    );
  }
  return (
    <div className={`flex items-center justify-center ${tileClass(name)} ${box}`}>
      <span className="text-5xl drop-shadow-md transition-transform duration-300 group-hover:scale-110 select-none">
        {emojiFor(name)}
      </span>
    </div>
  );
}

export const MenuTile = memo(MenuTileImpl);
