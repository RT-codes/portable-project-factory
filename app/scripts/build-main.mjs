// Bundle the desktop app's main process and preload script (electron/) into dist-electron/.
// `--watch` keeps rebuilding; scripts/dev.mjs uses it.
import { build, context } from 'esbuild'

const options = {
  entryPoints: { main: 'electron/main.ts', preload: 'electron/preload.ts' },
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
}

if (process.argv.includes('--watch')) await (await context(options)).watch()
else await build(options)
