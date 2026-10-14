import { defineConfig } from 'vitest/config';

// The suite targets the app's pure logic — geometry, cache identity,
// symbology and the analysis tools — none of which touch the DOM, the map
// or the network. A plain Node environment is therefore both correct and
// fast; jsdom would only add startup cost the tests do not need.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    globals: true,
    coverage: {
      provider: 'v8',
      // Measure only the modules the suite actually exercises, so coverage
      // reports the state of the tested logic rather than being diluted by
      // the UI, map and data-transport code this suite deliberately leaves
      // to manual and visual testing.
      include: [
        'src/core/geo.js',
        'src/data/cache/key.js',
        'src/layers/symbology.js',
        'src/data/overture-merge.js',
        'src/analysis/tools.js',
      ],
      reporter: ['text', 'html'],
    },
  },
});
