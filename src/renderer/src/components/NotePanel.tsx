import { useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import { usePanelStore } from '../store/panelStore'

interface Props {
  sessionId: string
}

const extensions = [
  StarterKit,
  TaskList,
  TaskItem.configure({ nested: true }),
  Placeholder.configure({ placeholder: 'Write a note...' })
]

export function NotePanel({ sessionId }: Props): React.JSX.Element {
  const noteContent = usePanelStore((s) => s.panels[sessionId]?.noteContent ?? '')
  const setNoteContent = usePanelStore((s) => s.setNoteContent)
  const skipUpdate = useRef(false)

  const editor = useEditor({
    extensions,
    content: noteContent,
    onUpdate({ editor: e }) {
      skipUpdate.current = true
      setNoteContent(sessionId, e.getHTML())
    }
  })

  // Sync from store if changed externally (e.g. undo at store level)
  useEffect(() => {
    if (!editor || skipUpdate.current) {
      skipUpdate.current = false
      return
    }
    if (editor.getHTML() !== noteContent) {
      editor.commands.setContent(noteContent, false)
    }
  }, [noteContent, editor])

  return (
    <div className="note-panel">
      <EditorContent editor={editor} className="note-panel-editor" />
    </div>
  )
}
