import type { Config } from 'tailwindcss'
import tailwindcssAnimate from 'tailwindcss-animate'

export default {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#1f6feb',
          foreground: '#ffffff'
        },
        primaryAccent: '#0f1a2b',
        brand: '#58a6ff',
        background: {
          DEFAULT: '#0d1117',
          secondary: '#161b22',
          tertiary: '#11161d'
        },
        secondary: '#e6edf3',
        border: '#30363d',
        accent: '#21262d',
        muted: '#7d8590',
        destructive: {
          DEFAULT: '#da3633',
          foreground: '#ffffff'
        },
        positive: {
          DEFAULT: '#238636',
          foreground: '#ffffff'
        },
        warning: {
          DEFAULT: '#d29922',
          foreground: '#0d1117'
        },
        card: '#161b22',
        popover: '#161b22'
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Helvetica',
          'Arial',
          'sans-serif'
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          '"SF Mono"',
          'Consolas',
          '"Liberation Mono"',
          'Menlo',
          'monospace'
        ],
        geist: 'var(--font-geist-sans)',
        dmmono: 'var(--font-geist-sans)'
      },
      borderRadius: {
        xl: '12px',
        '2xl': '16px',
        '3xl': '24px'
      }
    }
  },
  plugins: [tailwindcssAnimate]
} satisfies Config
