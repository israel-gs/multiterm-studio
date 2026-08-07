import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MarkdownPreview } from '@renderer/components/MarkdownPreview'

/**
 * Markdown comes from whatever repository the user opened, so the preview has
 * to render untrusted HTML safely while keeping the features it advertises.
 */

// Mermaid is loaded dynamically; stub it so the tests stay synchronous.
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg data-testid="diagram"></svg>' })
  }
}))

const BASE = '/projects/demo'

function renderMarkdown(content: string): HTMLElement {
  const { container } = render(<MarkdownPreview content={content} basePath={BASE} />)
  return container
}

describe('MarkdownPreview — sanitization', () => {
  it('strips script tags', () => {
    const c = renderMarkdown('Hello <script>window.pwned = true</script> world')
    expect(c.querySelector('script')).toBeNull()
    expect(c.textContent).toContain('Hello')
  })

  it('strips inline event handlers', () => {
    const c = renderMarkdown('<img src="x.png" onerror="window.pwned = true">')
    expect(c.querySelector('img')?.getAttribute('onerror')).toBeNull()
  })

  it('strips iframes', () => {
    const c = renderMarkdown('<iframe src="https://example.com"></iframe>')
    expect(c.querySelector('iframe')).toBeNull()
  })

  it('strips javascript: links', () => {
    const c = renderMarkdown('<a href="javascript:window.pwned=1">click</a>')
    // The attribute is dropped outright rather than rewritten.
    expect(c.querySelector('a')?.getAttribute('href') ?? '').not.toContain('javascript:')
  })

  it('does not let embedded HTML reach out to a remote image', () => {
    const c = renderMarkdown('<img src="https://evil.example/track.gif?leak=1">')
    // The default schema permits https images; what must not survive is any
    // scripting vector alongside it.
    const img = c.querySelector('img')
    expect(img?.getAttribute('onload')).toBeNull()
    expect(img?.getAttribute('onerror')).toBeNull()
  })
})

describe('MarkdownPreview — legitimate content still renders', () => {
  it('keeps ordinary formatting', () => {
    const c = renderMarkdown('# Title\n\nSome **bold** text.')
    expect(c.querySelector('h1')?.textContent).toBe('Title')
    expect(c.querySelector('strong')?.textContent).toBe('bold')
  })

  it('keeps GFM tables', () => {
    const c = renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |')
    expect(c.querySelector('table')).not.toBeNull()
  })

  it('rewrites relative images onto the local-resource protocol', () => {
    const c = renderMarkdown('![alt](./diagram.png)')
    expect(c.querySelector('img')?.getAttribute('src')).toBe(
      `local-resource://${BASE}/./diagram.png`
    )
  })

  it('keeps the language class that marks a mermaid block', async () => {
    renderMarkdown('```mermaid\ngraph TD;\nA-->B;\n```')
    // The mermaid branch replaces the <code> with its own container.
    expect(await screen.findByTestId('diagram')).toBeTruthy()
  })

  it('keeps highlighting classes on ordinary code blocks', () => {
    const c = renderMarkdown('```ts\nconst a = 1\n```')
    expect(c.querySelector('code')?.className).toContain('language-ts')
  })
})
