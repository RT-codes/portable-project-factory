// The desktop app with hot reload: Vite serves the page, esbuild builds the main process, Electron runs both.
//   npm run dev [-- <project folder>]
import { spawn } from 'node:child_process'
import { build } from 'esbuild'
import { createServer } from 'vite'

const server = await createServer()
await server.listen()
const url = server.resolvedUrls.local[0]

await build({
  entryPoints: { main: 'electron/main.ts', preload: 'electron/preload.ts' },
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
})

const electron = (await import('electron')).default
const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, FACTORY_APP_DEV_URL: url } })
child.on('exit', async (code) => {
  await server.close()
  process.exit(code ?? 0)
})
