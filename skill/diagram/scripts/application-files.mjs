// Explicit distributable application inputs. Never include user diagrams or installation metadata.
export const applicationFiles = ['package.json', 'package-lock.json', 'tsconfig.json', 'bin/sketch-diagram.mjs',
  'docs/cli.md', 'docs/schema.md', 'fixtures/concept-map.json', 'fixtures/canvas-overview-detail.json',
  'assets/fonts/Bangers-Regular.ttf', 'assets/fonts/Bangers-OFL.txt',
  'assets/fonts/Caveat-Regular.ttf', 'assets/fonts/Caveat-OFL.txt',
  'assets/fonts/NotoSans-Variable.ttf', 'assets/fonts/NotoSans-OFL.txt',
  'schemas/diagram.schema.json', 'schemas/patch.schema.json', 'schemas/graph.schema.json',
  'schemas/graph-patch.schema.json', 'schemas/canvas.schema.json', 'schemas/canvas-patch.schema.json'];
export const sourceNames = ['canvas-cli', 'canvas-renderer', 'capture', 'cli', 'document-store', 'documents',
  'geometry', 'graph-layout', 'paths', 'renderer', 'schema', 'server', 'storage'];
