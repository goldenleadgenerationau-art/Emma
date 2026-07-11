import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        black: '#050505',
        panel: '#0d0d0d',
        'panel-2': '#151515',
        gold: '#d5a43b',
        'gold-light': '#f1cf73',
        cream: '#f7f2e8',
        muted: '#a9a39a',
        success: '#43c982',
        danger: '#e96565',
      },
    },
  },
  plugins: [],
};

export default config;
