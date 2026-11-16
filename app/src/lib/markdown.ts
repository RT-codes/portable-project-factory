import { Marked } from 'marked'

// Ticket files come from agents that read user-written tickets, so raw HTML in them is shown as text, never run.
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const md = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html: ({ text }) => escape(text),
    link({ href, title, tokens }) {
      const safe = /^(https?:|mailto:|#|\/|\.)/i.test(href) ? href : '#'
      const label = this.parser.parseInline(tokens)
      return `<a href="${escape(safe)}"${title ? ` title="${escape(title)}"` : ''} target="_blank" rel="noreferrer">${label}</a>`
    },
    image: ({ text }) => escape(text),
  },
})

export function renderMarkdown(text: string): string {
  return md.parse(text, { async: false })
}
