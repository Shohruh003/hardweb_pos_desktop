import { emojiFor, getMenuImage, tileClass } from '../lib/menuImages';

// Taom rasmi yoki yorqin emoji-plitka (rasm bo'lmasa). Hover'da jonlanadi.
export function MenuTile({
  name,
  image,
  imageKey,
}: {
  name: string;
  image?: string | null;
  imageKey?: string;
}) {
  const src = image || getMenuImage(name, imageKey);
  if (src) {
    return (
      <div className="aspect-[4/3] overflow-hidden rounded-xl">
        <img
          src={src}
          alt={name}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
        />
      </div>
    );
  }
  return (
    <div
      className={`aspect-[4/3] rounded-xl flex items-center justify-center ${tileClass(name)}`}
    >
      <span className="text-5xl drop-shadow-md transition-transform duration-300 group-hover:scale-125">
        {emojiFor(name)}
      </span>
    </div>
  );
}
