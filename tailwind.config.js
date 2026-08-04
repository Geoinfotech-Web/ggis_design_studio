/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,html}'],
  // Component classes the UI builds at runtime (`btn-${variant}`) are not
  // visible to the scanner, so they are pinned here.
  safelist: [
    'btn-primary', 'btn-ghost', 'btn-soft', 'icon-btn',
    'field', 'field-label', 'panel-title', 'card', 'chip',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Source Sans 3"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      colors: {
        ink: '#0f172a',
        river: '#0369a1',
        mist: '#e0f2fe',
      },
    },
  },
  plugins: [],
};
