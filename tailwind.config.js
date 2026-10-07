/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./frontend/index.html",
    "./frontend/main.jsx",
    "./frontend/apps/**/*.{js,ts,jsx,tsx}",
    "./frontend/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#3b82f6',
        secondary: '#8b5cf6',
        dark: '#111827',
        darker: '#0f172a',
        soma: {
          950: '#0a0a0a',
          900: '#171717',
          800: '#262626',
          accent: '#06b6d4',
        },
        cyber: {
          primary: 'rgba(168, 85, 247, 1)', // Purple-500 equivalent
          base: '#090410',
          white: '#ffffff',
          muted: '#94a3b8', // slate-400
          accent: '#d8b4fe', // purple-300
          deep: '#0f172a', // slate-900 or darker
          vivid: '#c084fc', // purple-400
          panel: '#1e293b' // slate-800
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        marquee: 'marquee 15s linear infinite', // Adjust duration as needed
      },
      keyframes: {
        marquee: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(-100%)' },
        },
      },
    },
  },
  plugins: [],
}
