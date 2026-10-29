import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0C0B0A',
          900: '#12100E',
          880: '#171411',
          850: '#151210',
          800: '#1C1814',
          700: '#2A231C',
          600: '#3A3025'
        },
        aurora: {
          50: '#FFF9EA',
          100: '#F8EBCB',
          300: '#E8C987',
          400: '#D9B66C',
          500: '#B88A3B',
          600: '#956A27',
          700: '#6D4A1D'
        },
        mint: {
          300: '#8CF5C6',
          400: '#4FEBAB',
          500: '#22D69B',
          600: '#0FA97A'
        },
        lime: {
          300: '#DEFF7A',
          400: '#CBFF3D',
          500: '#B2F000'
        },
        ember: {
          400: '#FF8A5B',
          500: '#FF6B3D'
        }
      },
      fontFamily: {
        sans: [
          'var(--font-sans)',
          'ui-sans-serif',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Inter',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif'
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        display: [
          'var(--font-display)',
          'ui-serif',
          'Iowan Old Style',
          'Apple Garamond',
          'Georgia',
          'Times New Roman',
          'serif'
        ]
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(255,255,255,0.06), 0 24px 70px -30px rgba(124,92,255,0.55)',
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 30px 60px -40px rgba(0,0,0,0.9)',
        lift: '0 30px 80px -40px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.07)'
      },
      borderRadius: {
        '4xl': '2rem'
      },
      keyframes: {
        floaty: {
          '0%,100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-14px)' }
        },
        drift: {
          '0%,100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '50%': { transform: 'translate3d(3%, -4%, 0) scale(1.08)' }
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' }
        },
        popIn: {
          '0%': { opacity: '0', transform: 'translateY(10px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' }
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateX(24px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' }
        },
        pulseRing: {
          '0%': { boxShadow: '0 0 0 0 rgba(203,255,61,0.45)' },
          '70%': { boxShadow: '0 0 0 14px rgba(203,255,61,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(203,255,61,0)' }
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' }
        },
        toastBar: {
          '0%': { transform: 'scaleX(1)' },
          '100%': { transform: 'scaleX(0)' }
        }
      },
      animation: {
        floaty: 'floaty 7s ease-in-out infinite',
        drift: 'drift 18s ease-in-out infinite',
        shimmer: 'shimmer 3s linear infinite',
        popIn: 'popIn 0.45s cubic-bezier(0.22,1,0.36,1) both',
        fadeIn: 'fadeIn 0.2s ease-out both',
        slideIn: 'slideIn 0.4s cubic-bezier(0.22,1,0.36,1) both',
        pulseRing: 'pulseRing 2s ease-out infinite',
        marquee: 'marquee 32s linear infinite',
        toastBar: 'toastBar 4.5s linear forwards'
      }
    }
  },
  plugins: []
};

export default config;
