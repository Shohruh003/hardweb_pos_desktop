/** @type {import('tailwindcss').Config} */
// Ranglar shared/src/theme.ts bilan bir xil (ko'k YO'Q, kontrastli).
export default {
  content: ['./src/renderer/**/*.{html,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#15181E',
        surface: '#1F242D',
        'surface-hover': '#262C36',
        border: '#2D333D',
        text: '#F4F6F8',
        muted: '#A8B0BD',
        primary: '#059669',
        'primary-hover': '#047857',
        success: '#22C55E',
        warning: '#F59E0B',
        danger: '#EF4444',
        info: '#8B5CF6',
      },
    },
  },
  plugins: [],
};
