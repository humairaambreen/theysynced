/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './src_frontend/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        apple: {
          bg: '#F8F9FB',
          card: '#FFFFFF',
          dark: '#111827',
          muted: '#6B7280',
          periwinkle: '#E0E3FF',
          olive: '#7F7149',
          cream: '#F4F2EC',
          purple: '#E3D8FF',
          border: 'rgba(0, 0, 0, 0.06)',
        },
      },
      fontFamily: {
        sans: ['Satoshi', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'San Francisco', 'sans-serif'],
      },
      borderRadius: {
        '4xl': '32px',
        '5xl': '40px',
        '6xl': '48px',
        'squircle': '44px',
      },
      boxShadow: {
        'apple': '0 10px 40px -10px rgba(0, 0, 0, 0.05)',
        'apple-hover': '0 20px 50px -12px rgba(0, 0, 0, 0.08)',
        'pill': '0 4px 20px rgba(0,0,0,0.04)',
      },
    },
  },
  plugins: [],
};
