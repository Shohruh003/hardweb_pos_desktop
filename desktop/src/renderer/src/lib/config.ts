// Lokal server manzili. Boshqa kompyuterdagi terminallar uchun bu yerni
// server IP'siga o'zgartiriladi (masalan http://192.168.1.10:3000).
// localStorage orqali ham bekor qilish mumkin (admin sozlamasi).
const DEFAULT_SERVER = 'http://localhost:3000';

export function getServerUrl(): string {
  return localStorage.getItem('server_url') || DEFAULT_SERVER;
}

export function setServerUrl(url: string): void {
  localStorage.setItem('server_url', url);
}
