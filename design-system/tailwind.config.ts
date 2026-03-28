import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#FAF9F6',
        surface: '#F8F9F4',
        ink: '#2D2D2D',
        coral: '#F48C76',
        mustard: '#F1B457',
        sage: '#A9D18E',
        sky: '#92C5F9',
      },
      fontFamily: {
        serif: ['ui-serif', 'Georgia', 'Times New Roman', 'Times', 'serif'],
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          'Apple Color Emoji',
          'Segoe UI Emoji',
        ],
      },
      boxShadow: {
        soft: '0 8px 30px rgb(0 0 0 / 0.04)',
      },
    },
  },
} satisfies Config

