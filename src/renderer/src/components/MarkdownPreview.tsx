import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import type { Components } from 'react-markdown'

/**
 * Mermaid is ~2 MB and most markdown has no diagrams, so it is fetched the
 * first time a ```mermaid block actually renders.
 */
type Mermaid = typeof import('mermaid').default
let mermaidPromise: Promise<Mermaid> | null = null

function loadMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: {
          darkMode: true,
          background: '#1c1c1c',
          primaryColor: '#264f78',
          primaryTextColor: '#d4d4d4',
          primaryBorderColor: '#3e3e3e',
          lineColor: '#808080',
          secondaryColor: '#2a2a2a',
          tertiaryColor: '#333'
        }
      })
      return mermaid
    })
  }
  return mermaidPromise
}

let mermaidCounter = 0

function MermaidBlock({ chart }: { chart: string }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const id = `mermaid-${++mermaidCounter}`
    let cancelled = false

    loadMermaid()
      .then((mermaid) => mermaid.render(id, chart))
      .then(({ svg }) => {
        if (!cancelled) el.innerHTML = svg
      })
      .catch(() => {
        if (cancelled) return
        el.textContent = 'Failed to render diagram'
        el.classList.add('md-preview-mermaid-error')
      })

    return () => {
      cancelled = true
    }
  }, [chart])

  return <div ref={containerRef} className="md-preview-mermaid" />
}

/**
 * Markdown is rendered from whatever files a project contains — including
 * repositories cloned from strangers — and rehypeRaw turns embedded HTML into
 * real nodes. Sanitizing after it strips scripts, iframes, event handlers and
 * anything else the default schema does not vouch for.
 *
 * The schema is extended for the two things this preview legitimately needs:
 * mermaid/language class names on code blocks, and the `local-resource:`
 * protocol used for images that live next to the document.
 */
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-./]]
  },
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), 'local-resource']
  }
}

interface MarkdownPreviewProps {
  content: string
  basePath: string
}

function resolveUrl(src: string | undefined, basePath: string): string | undefined {
  if (!src) return src
  // Already absolute URL — leave as-is
  if (/^(https?:|data:|file:|blob:|local-resource:)/.test(src)) return src
  // Absolute filesystem path
  if (src.startsWith('/')) return `local-resource://${src}`
  // Relative path — resolve against basePath
  return `local-resource://${basePath}/${src}`
}

function buildComponents(basePath: string): Components {
  return {
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '')
      const lang = match?.[1]

      if (lang === 'mermaid') {
        return <MermaidBlock chart={String(children).replace(/\n$/, '')} />
      }

      if (!className) {
        return (
          <code className="md-preview-inline-code" {...props}>
            {children}
          </code>
        )
      }

      return (
        <code className={`md-preview-code-block ${className ?? ''}`} {...props}>
          {children}
        </code>
      )
    },
    pre({ children }) {
      return <pre className="md-preview-pre">{children}</pre>
    },
    img({ src, alt, ...props }) {
      return <img src={resolveUrl(src, basePath)} alt={alt} {...props} />
    }
  }
}

export function MarkdownPreview({ content, basePath }: MarkdownPreviewProps): React.JSX.Element {
  const components = buildComponents(basePath)

  return (
    <div className="md-preview">
      <div className="md-preview-content">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          // Order matters: raw HTML has to become nodes before it can be sanitized.
          rehypePlugins={[rehypeRaw, [rehypeSanitize, schema]]}
          components={components}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  )
}
