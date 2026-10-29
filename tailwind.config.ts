import type { Config } from 'tailwindcss';

/**
 * Parikshio design tokens — "midnight & champagne".
 *
 *  ink    deep midnight navy surfaces (950 = page, 600 = raised edges)
 *  gold   champagne gold: primary actions, live state, brand accents
 *  royal  royal indigo: selection, info and secondary emphasis
 *  mint   emerald: correct / online / success
 *  ember  coral red: incorrect / urgent / destructive
 *
 * Amber (warnings) and sky (informational) come from Tailwind's defaults.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#060A14',
          900: '#0A0F1D',
          880: '#0C1222',
          850: '#0F1527',
          800: '#131B30',
          700: '#1B2541',
          600: '#273256'
        },
        gold: {
          50: '#FDF9EF',
          100: '#FBF1DC',
          200: '#F5E3BA',
          300: '#EBCF95',
          400: '#DFB873',
          500: '#CBA054',
          600: '#A9813D',
          700: '#80612F'
        },
        royal: {
          50: '#EEF2FF',
          100: '#DEE5FF',
          200: '#C3CEFF',
          300: '#A3B3FF',
          400: '#8197FF',
          500: '#6279F5',
          600: '#4C60E0',
          700: '#3B4BB8'
        },
        mint: {
          100: '#D8F6EA',
          200: '#B3EDD5',
          300: '#8BE3C0',
          400: '#53CFA2',
          500: '#2BB487',
          600: '#1C9470'
        },
        ember: {
          100: '#FFE3DE',
          200: '#FFCBC2',
          300: '#FFB3A7',
          400: '#FF8B7B',
          500: '#F06656',
          600: '#D44A3C'
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
        glow: '0 0 0 1px rgba(255,255,255,0.06), 0 24px 70px -30px rgba(98,121,245,0.45)',
        card: 'inset 0 1px 0 0 rgba(255,255,255,0.05), 0 1px 2px rgba(0,0,0,0.35), 0 28px 56px -36px rgba(0,0,0,0.9)',
        lift: '0 32px 80px -40px rgba(0,0,0,0.95), 0 0 0 1px rgba(255,255,255,0.08)',
        gold: '0 14px 34px -16px rgba(223,184,115,0.6)'
      },
      borderRadius: {
        '4xl': '2rem'
      },
      keyframes: {
        floaty: {
          // `translate`, not `transform`, so it composes with positioning
          // utilities such as -translate-y-full on the same element.
          '0%,100%': { translate: '0 0' },
          '50%': { translate: '0 -12px' }
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
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(18px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateX(24px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' }
        },
        slideInLeft: {
          '0%': { opacity: '0', transform: 'translateX(-24px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' }
        },
        pulseRing: {
          '0%': { boxShadow: '0 0 0 0 rgba(223,184,115,0.45)' },
          '70%': { boxShadow: '0 0 0 14px rgba(223,184,115,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(223,184,115,0)' }
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' }
        },
        toastBar: {
          '0%': { transform: 'scaleX(1)' },
          '100%': { transform: 'scaleX(0)' }
        },
        spinSlow: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' }
        }
      },
      animation: {
        floaty: 'floaty 7s ease-in-out infinite',
        drift: 'drift 18s ease-in-out infinite',
        shimmer: 'shimmer 3s linear infinite',
        popIn: 'popIn 0.45s cubic-bezier(0.22,1,0.36,1) both',
        fadeUp: 'fadeUp 0.7s cubic-bezier(0.22,1,0.36,1) both',
        fadeIn: 'fadeIn 0.2s ease-out both',
        slideIn: 'slideIn 0.4s cubic-bezier(0.22,1,0.36,1) both',
        slideInLeft: 'slideInLeft 0.35s cubic-bezier(0.22,1,0.36,1) both',
        pulseRing: 'pulseRing 2.2s ease-out infinite',
        marquee: 'marquee 40s linear infinite',
        toastBar: 'toastBar 4.5s linear forwards',
        spinSlow: 'spinSlow 48s linear infinite'
      }
    }
  },
  plugins: []
};

export default config;
