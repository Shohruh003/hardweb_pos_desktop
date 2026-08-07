/** @type {import('tailwindcss').Config} */
// Ranglar CSS o'zgaruvchilari orqali (Dark/Light tema uchun).
// RGB kanal texnikasi — Tailwind opacity modifikatorlari (bg-danger/15) ishlashi uchun.
// Qiymatlar index.css ichida :root (dark) va [data-theme="light"] da belgilanadi.
const c = (v) => `rgb(var(${v}) / <alpha-value>)`;

export default {
  content: ['./src/renderer/**/*.{html,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: c('--c-bg'),
        surface: c('--c-surface'),
        'surface-hover': c('--c-surface-hover'),
        border: c('--c-border'),
        text: c('--c-text'),
        muted: c('--c-muted'),
        primary: c('--c-primary'),
        'primary-hover': c('--c-primary-hover'),
        success: c('--c-success'),
        warning: c('--c-warning'),
        danger: c('--c-danger'),
        info: c('--c-info'),
      },
    },
  },
  plugins: [],
};
