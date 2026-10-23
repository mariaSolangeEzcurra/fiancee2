export default {content: [
  './index.html',
  './src/**/*.{js,ts,jsx,tsx}'
],
  theme: {
    extend: {
      colors: {
        ivory: '#FBF8F3',
        paper: '#FFFDF9',
        cream: '#F4EDE3',
        sand: '#E8DCCB',
        nude: '#D8BFA8',
        line: '#E7DCCE',
        blush: { DEFAULT: '#E4C3BC', soft: '#F5E6E2', deep: '#9E6A63' },
        champagne: { DEFAULT: '#E9D8B6', soft: '#F6EEDD' },
        gold: { DEFAULT: '#9A7640', soft: '#CDB17A' },
        cocoa: { DEFAULT: '#4A3428', muted: '#76604F', faint: '#A8958A' },
        ok: { DEFAULT: '#4E6E4A', soft: '#E4ECDF' },
        risk: { DEFAULT: '#8A6214', soft: '#F5E9CC' },
        bad: { DEFAULT: '#843236', soft: '#F3DFDC' },
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
};
