import fs from 'node:fs/promises'
import path from 'node:path'
import type { UsageRun } from '../shared/api'

// What the factory's agent runs took, for the Usage view. Two places hold it, and neither is a file of its own:
//  - a ticket on this machine: the runs in its job.json (.factory/jobs/, not committed)
//  - a ticket that is finished or deleted: the `usage` rows of its journal entry (.factory/journal/, committed with
//    the change), which is how the numbers reach a colleague's checkout and outlive the ticket's folder
// A ticket found in both is read from this machine: its runs are dated one by one there.

const MAX_ENTRY = 256 * 1024
const MAX_FILES = 5000
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
const str = (v: unknown) => (typeof v === 'string' ? v : '')

function split(by: string): { agent: string; model: string } {
  const i = by.indexOf(':')
  return i === -1 ? { agent: '', model: by } : { agent: by.slice(0, i), model: by.slice(i + 1) }
}

async function fromTickets(factory: string): Promise<UsageRun[]> {
  const runs: UsageRun[] = []
  let terminal = new Set<string>()
  try {
    const config = JSON.parse(await fs.readFile(path.join(factory, 'config.json'), 'utf8'))
    terminal = new Set((config.stages ?? []).filter((s: { terminal?: boolean }) => s.terminal).map((s: { key: string }) => s.key))
  } catch {}
  const jobsDir = path.join(factory, 'jobs')
  for (const id of (await fs.readdir(jobsDir).catch(() => [] as string[])).sort()) {
    try {
      const job = JSON.parse(await fs.readFile(path.join(jobsDir, id, 'job.json'), 'utf8'))
      const state = job.stage === 'dropped' ? 'dropped' : job.landed ? 'merged' : terminal.has(job.stage) ? 'done' : 'open'
      for (const a of job.activity ?? []) {
        if ((a.kind !== 'agent' && a.kind !== 'waiting') || !str(a.by)) continue
        // a run recorded before the token kinds were kept apart has one total
        const parts = num(a.input) + num(a.cache_read) + num(a.cache_write) + num(a.output)
        runs.push({
          ticket: str(job.id),
          title: str(job.title),
          state,
          at: str(a.at),
          stage: str(a.stage) || str(a.role),
          round: num(a.round),
          ...split(str(a.by)),
          result: str(a.result),
          secs: num(a.secs),
          turns: num(a.turns),
          input: parts ? num(a.input) : 0,
          cache_read: num(a.cache_read),
          cache_write: num(a.cache_write),
          output: num(a.output),
          unsplit: parts ? 0 : num(a.tokens),
          cost_usd: num(a.cost_usd),
        })
      }
    } catch {
      /* not a ticket folder, or mid-write */
    }
  }
  return runs
}

async function fromJournal(factory: string, known: Set<string>): Promise<UsageRun[]> {
  const runs: UsageRun[] = []
  const listed = await fs.readdir(path.join(factory, 'journal'), { recursive: true, withFileTypes: true }).catch(() => [])
  for (const e of listed.slice(0, MAX_FILES)) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue
    try {
      const full = path.join(e.parentPath, e.name)
      if ((await fs.stat(full)).size > MAX_ENTRY) continue
      const head = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(await fs.readFile(full, 'utf8'))?.[1]
      if (!head || !head.includes('\nusage:')) continue
      const meta: Record<string, string> = {}
      for (const line of head.split(/\r?\n/)) {
        const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
        if (kv) meta[kv[1]] = kv[2]
      }
      const unquote = (v = '') => (v.startsWith('"') ? String(JSON.parse(v)) : v)
      const ticket = unquote(meta.ticket)
      if (!ticket || known.has(ticket) || Number.isNaN(Date.parse(unquote(meta.at)))) continue
      const rows: unknown = JSON.parse(meta.usage)
      if (!Array.isArray(rows)) continue
      const deleted = /"deleted"/.test(meta.tags ?? '')
      for (const row of rows.slice(0, 500)) {
        if (!Array.isArray(row)) continue
        // the order the factory's CLI writes them in (USAGE_COLUMNS)
        const [stage, round, by, result, secs, turns, input, cacheRead, cacheWrite, output, cost] = row
        // Codex reports one total, which the CLI puts under input
        const one = !num(cacheRead) && !num(cacheWrite) && !num(output)
        runs.push({
          ticket,
          title: unquote(meta.title).replace(/^Deleted ticket \d+: /, ''),
          state: deleted ? 'deleted' : 'merged',
          at: unquote(meta.at),
          stage: str(stage),
          round: num(round),
          ...split(str(by)),
          result: str(result),
          secs: num(secs),
          turns: num(turns),
          input: one ? 0 : num(input),
          cache_read: num(cacheRead),
          cache_write: num(cacheWrite),
          output: num(output),
          unsplit: one ? num(input) : 0,
          cost_usd: num(cost),
        })
      }
    } catch {
      /* an entry that does not parse has no usage to show */
    }
  }
  return runs
}

export async function usage(repo: string): Promise<UsageRun[]> {
  const factory = path.join(repo, '.factory')
  const local = await fromTickets(factory)
  const journal = await fromJournal(factory, new Set(local.map((r) => r.ticket)))
  return [...journal, ...local].sort((a, b) => a.at.localeCompare(b.at))
}
