// `node --test kit/test/` must work on every Node from 20 on. Node 20 searches the folder for *.test.mjs
// files and never runs this one; Node 21 and later load the folder as a module, which runs this file, so it
// imports every test file itself.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
for (const name of fs.readdirSync(here).filter((n) => n.endsWith('.test.mjs')).sort()) {
  await import(pathToFileURL(path.join(here, name)).href)
}
