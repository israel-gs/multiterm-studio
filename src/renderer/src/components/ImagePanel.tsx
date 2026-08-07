import { useState } from 'react'
import { basename } from '../utils/path'

interface ImagePanelProps {
  sessionId: string
  filePath: string
}

export function ImagePanel({ filePath }: ImagePanelProps): React.JSX.Element {
  const [error, setError] = useState(false)

  return (
    <div className="image-panel">
      {error ? (
        <div className="image-panel-error">Failed to load image</div>
      ) : (
        <img
          src={`local-resource://${filePath}`}
          alt={basename(filePath) || 'Image'}
          draggable={false}
          onError={() => setError(true)}
        />
      )}
    </div>
  )
}
