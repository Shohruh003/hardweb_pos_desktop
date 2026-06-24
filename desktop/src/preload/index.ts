import { contextBridge } from 'electron';

// Hozircha terminal ilovasiga maxsus native API kerak emas.
// Keyingi bosqichlarda bu yerga printer (ESC/POS) va skaner ko'priklari qo'shiladi.
contextBridge.exposeInMainWorld('hardweb', {
  platform: process.platform,
  version: process.versions.electron,
});
