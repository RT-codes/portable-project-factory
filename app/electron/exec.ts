import { spawn } from 'node:child_process'

export interface RunResult {
  code: number
  stdout: Buffer
  stderr: string
}

export interface RunOptions {
  cwd?: string
  input?: string
  /** resolve with a non-zero exit instead of throwing */
  allowFail?: boolean
  env?: NodeJS.ProcessEnv
  /** stop the program after this long and fail */
  timeoutMs?: number
}

/** A command that could not be started, or exited non-zero. `message` is fit to show a person. */
export class ExecError extends Error {
  readonly code: number | 'ENOENT'
  readonly stderr: string

  constructor(message: string, code: number | 'ENOENT', stderr: string) {
    super(message)
    this.code = code
    this.stderr = stderr
  }
}

const MAX_OUTPUT = 256 * 1024 * 1024

/** Run a program with an argument list (never through a shell) and collect its output. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let size = 0
    child.stdout.on('data', (b: Buffer) => {
      size += b.length
      if (size > MAX_OUTPUT) child.kill()
      else out.push(b)
    })
    child.stderr.on('data', (b: Buffer) => err.push(b))
    let timedOut = false
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          child.kill()
        }, opts.timeoutMs)
      : null
    child.on('error', (e: NodeJS.ErrnoException) => {
      if (timer) clearTimeout(timer)
      if (e.code === 'ENOENT') reject(new ExecError(`${cmd} is not installed or not on PATH`, 'ENOENT', ''))
      else reject(new ExecError(`${cmd}: ${e.message}`, -1, ''))
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      const stderr = Buffer.concat(err).toString('utf8').trim()
      if (timedOut) return reject(new ExecError(`${cmd} ${args[0] ?? ''}: took too long and was stopped`, -1, stderr))
      if (size > MAX_OUTPUT) return reject(new ExecError(`${cmd} ${args[0] ?? ''}: output too large`, -1, stderr))
      const result = { code: code ?? -1, stdout: Buffer.concat(out), stderr }
      if (result.code !== 0 && !opts.allowFail) {
        const first = stderr.split('\n').find((l) => l.trim()) ?? `exit ${result.code}`
        return reject(new ExecError(`${cmd} ${args[0] ?? ''}: ${first}`, result.code, stderr))
      }
      resolve(result)
    })
    // a child that exits without reading its input must not take the app down with EPIPE
    child.stdin.on('error', () => {})
    child.stdin.end(opts.input ?? '')
  })
}
