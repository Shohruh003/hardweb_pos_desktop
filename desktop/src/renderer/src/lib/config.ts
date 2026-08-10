// Lokal server manzili. Boshqa kompyuterdagi terminallar uchun bu yerni
// server IP'siga o'zgartiriladi (masalan http://192.168.1.10:3000).
// localStorage orqali ham bekor qilish mumkin (admin sozlamasi).
const DEFAULT_SERVER = 'http://127.0.0.1:3100';

export function getServerUrl(): string {
  const saved = localStorage.getItem('server_url');
  // Saqlangan manzil lokal (localhost/127.0.0.1) bo'lsa — eski/noto'g'ri port
  // saqlanib qolgan bo'lishi mumkin, shuning uchun doim DEFAULT_SERVER ishlatamiz.
  // Faqat haqiqiy LAN IP (masalan 192.168.x.x) saqlangan bo'lsa, uni hurmat qilamiz.
  if (saved && !/:\/\/(localhost|127\.0\.0\.1)/.test(saved)) {
    return saved;
  }
  // Brauzerda LAN host (telefon/planshet) orqali ochilgan bo'lsa —
  // serverni shu hostning 3100 portiga yo'naltiramiz (qo'lda kiritish shart emas).
  try {
    const loc = window.location;
    const h = loc.hostname;
    if (loc.protocol.startsWith('http') && h && h !== 'localhost' && h !== '127.0.0.1') {
      return `http://${h}:3100`;
    }
  } catch {
    /* electron file:// — pastdagi default ishlaydi */
  }
  return DEFAULT_SERVER;
}

export function setServerUrl(url: string): void {
  localStorage.setItem('server_url', url);
}
