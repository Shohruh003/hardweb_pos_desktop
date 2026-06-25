import { Button } from './ui';

export type FeedbackVariant = 'success' | 'info' | 'warning';

const VARIANT: Record<
  FeedbackVariant,
  { ring: string; glow: string; confetti: string[] }
> = {
  success: { ring: 'text-success', glow: 'shadow-[0_0_60px_-10px_rgba(34,197,94,0.6)]', confetti: ['#22C55E', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6'] },
  info: { ring: 'text-info', glow: 'shadow-[0_0_60px_-10px_rgba(139,92,246,0.6)]', confetti: ['#8B5CF6', '#22C55E', '#F59E0B'] },
  warning: { ring: 'text-warning', glow: 'shadow-[0_0_60px_-10px_rgba(245,158,11,0.6)]', confetti: ['#F59E0B', '#EF4444'] },
};

// Chiroyli markazlashgan feedback modali — katta belgi + confetti + OK tugmasi
export function FeedbackModal({
  variant = 'success',
  title,
  subtitle,
  onClose,
}: {
  variant?: FeedbackVariant;
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  const v = VARIANT[variant];
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-overlay-in"
      onClick={onClose}
    >
      <div
        className={`relative bg-surface border border-border rounded-3xl px-10 py-9 w-[380px] text-center animate-pop-in ${v.glow}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Confetti */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center gap-2 overflow-visible">
          {Array.from({ length: 14 }).map((_, i) => (
            <span
              key={i}
              className="confetti-piece absolute top-2 w-2 h-2 rounded-[2px]"
              style={{
                left: `${8 + i * 6.2}%`,
                background: v.confetti[i % v.confetti.length],
                animationDelay: `${(i % 5) * 0.06}s`,
              }}
            />
          ))}
        </div>

        {/* Belgi */}
        <div className={`mx-auto mb-5 w-24 h-24 rounded-full bg-bg flex items-center justify-center animate-ring ${v.ring}`}>
          {variant === 'success' ? (
            <svg width="56" height="56" viewBox="0 0 52 52" fill="none">
              <circle cx="26" cy="26" r="24" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
              <path className="check-path" d="M15 27 l8 8 l15 -17" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <span className="text-5xl font-black">{variant === 'warning' ? '!' : 'i'}</span>
          )}
        </div>

        <div className="text-2xl font-extrabold mb-1">{title}</div>
        {subtitle && <div className="text-muted mb-6">{subtitle}</div>}
        {!subtitle && <div className="mb-6" />}

        <Button className="w-full py-3 text-lg" onClick={onClose}>
          OK
        </Button>
      </div>
    </div>
  );
}
