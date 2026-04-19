import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import mermaid from 'mermaid'
import type { Components } from 'react-markdown'

// Initialize mermaid once
let mermaidInitialized = false
function ensureMermaid(): void {
  if (mermaidInitialized) return
  mermaidInitialized = true
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
}

let mermaidCounter = 0

function MermaidBlock({ chart }: { chart: string }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    ensureMermaid()
    const id = `mermaid-${++mermaidCounter}`

    mermaid
      .render(id, chart)
      .then(({ svg }) => {
        el.innerHTML = svg
      })
      .catch(() => {
        el.textContent = 'Failed to render diagram'
        el.classList.add('md-preview-mermaid-error')
      })
  }, [chart])

  return <div ref={containerRef} className="md-preview-mermaid" />
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
          rehypePlugins={[rehypeRaw]}
          components={components}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  )
}
