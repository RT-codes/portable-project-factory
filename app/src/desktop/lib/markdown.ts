import DOMPurify from 'dompurify'
import { Marked } from 'marked'

// Markdown from GitHub (issue and pull request bodies, comments). Unlike a ticket's files it may carry HTML
// (<details>, <img>, tables), so it is rendered and then sanitized: no scripts, no handlers, no styles, no forms.

const md = new Marked({ gfm: true, breaks: true })

const purify = DOMPurify()
purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    const href = node.getAttribute('href') ?? ''
    // links open in the browser (the main process sees to that); anything that is not a web link goes nowhere
    if (/^https?:\/\//i.test(href)) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noreferrer')
    } else {
      node.removeAttribute('href')
    }
  }
  if (node.tagName === 'IMG') {
    if (!/^https:\/\//i.test(node.getAttribute('src') ?? '')) node.remove()
    else node.setAttribute('loading', 'lazy')
  }
  if (node.tagName === 'INPUT') node.setAttribute('disabled', '')
})

export function renderGithubMarkdown(text: string): string {
  const html = md.parse(text, { async: false })
  return purify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'iframe', 'video', 'audio', 'svg', 'math'],
    FORBID_ATTR: ['style', 'class', 'id', 'name'],
  })
}
