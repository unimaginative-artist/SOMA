/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./apps/**/*.{js,ts,jsx,tsx}",
    "./*.{js,ts,jsx,tsx}"
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
          success: '#10b981', // Adding success/warning/danger for completeness as they were used in components
          warning: '#f59e0b',
          danger: '#ef4444',
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
}
