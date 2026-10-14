// Shared Tailwind (Play CDN) theme — mirrors the future tailwind.config.ts
tailwind.config = {
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        cream: {
          DEFAULT: '#FFFDD0',
          50: '#FFFEF2',
          100: '#FFFDD0',
          200: '#F6F2BF',
          300: '#E9E3A6',
        },
        olive: {
          50: '#F4F6EE',
          100: '#E7ECDB',
          200: '#CFD9B6',
          300: '#AFC08A',
          400: '#88A05C',
          500: '#6B8440',
          600: '#556B2F',
          700: '#465827',
          800: '#384620',
          900: '#2B361A',
        },
        yt: '#e34948',
        fb: '#2a78d6',
      },
      boxShadow: {
        card: '0 1px 2px rgba(40, 38, 20, 0.04), 0 1px 3px rgba(40, 38, 20, 0.06)',
        pop: '0 10px 30px -10px rgba(40, 38, 20, 0.25)',
      },
    },
  },
};
