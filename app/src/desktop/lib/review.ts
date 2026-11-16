import type { DiffFile, DraftComment, ReviewThread } from '$shared/api'

/** What the diff viewer needs to show and take review comments. Absent when the diff is not a pull request. */
export interface ReviewHooks {
  threads: ReviewThread[]
  /** comments written but not yet sent: they go out together when the review is submitted */
  drafts: DraftComment[]
  addDraft(draft: DraftComment): void
  updateDraft(draft: DraftComment, body: string): void
  removeDraft(draft: DraftComment): void
  reply(thread: ReviewThread, body: string): Promise<void>
  resolve(thread: ReviewThread, resolved: boolean): Promise<void>
}

/** A fingerprint of a file's diff: a file marked as viewed stays so until its diff changes. */
export function signature(file: DiffFile): string {
  let h = 5381
  const eat = (s: string) => {
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  eat(`${file.status}:${file.oldPath ?? ''}:${file.additions}:${file.deletions}`)
  for (const hunk of file.hunks) for (const line of hunk.lines) if (line.kind !== 'ctx') eat(line.kind[0] + line.text)
  return (h >>> 0).toString(36)
}

export const STATUS_LETTER = { added: 'A', deleted: 'D', modified: 'M', renamed: 'R' } as const
export const STATUS_TONE = { added: 'text-tone-green', deleted: 'text-tone-rose', modified: 'text-tone-amber', renamed: 'text-tone-sky' } as const
