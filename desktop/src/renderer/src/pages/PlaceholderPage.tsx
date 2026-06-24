import { AppShell } from '../components/AppShell';

// Hali qurilmagan modullar uchun vaqtinchalik ekran (bosqichni ko'rsatadi)
export function PlaceholderPage({
  title,
  bosqich,
  tavsif,
}: {
  title: string;
  bosqich: string;
  tavsif: string;
}) {
  return (
    <AppShell title={title}>
      <div className="h-full flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="inline-block px-3 py-1 rounded-full bg-warning/20 text-warning text-sm font-semibold mb-4">
            {bosqich}
          </div>
          <h2 className="text-2xl font-bold mb-2">{title}</h2>
          <p className="text-muted">{tavsif}</p>
        </div>
      </div>
    </AppShell>
  );
}
