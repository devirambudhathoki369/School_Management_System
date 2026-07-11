import { useRef, useState, type DragEvent } from 'react'
import { IconSpinner } from './icons'

/**
 * Drop-zone uploader: drag & drop, tap-to-browse, camera capture on phones.
 * Validation is server-side (content sniffing) — this component only shapes
 * the hand-off and shows progress; a rejected file surfaces the API error.
 */
export default function FileUpload({
  onFile,
  accept = 'image/*',
  capture = false,
  busy = false,
  label = 'Drop a file here, or tap to browse',
  hint,
  className = '',
}: {
  onFile: (file: File) => void
  accept?: string
  /** Offer the device camera on phones (person photos). */
  capture?: boolean
  busy?: boolean
  label?: string
  hint?: string
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file && !busy) onFile(file)
  }

  return (
    <div className={className}>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex min-h-28 w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-sm transition-colors ${
          dragging
            ? 'border-accent bg-accent-soft/60 text-accent-strong'
            : 'border-border text-ink-muted hover:border-accent hover:bg-surface-muted'
        } ${busy ? 'cursor-wait opacity-70' : ''}`}
      >
        {busy ? (
          <>
            <IconSpinner size={20} />
            Uploading…
          </>
        ) : (
          <>
            <span className="font-medium">{label}</span>
            {hint && <span className="text-xs text-ink-faint">{hint}</span>}
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        {...(capture ? { capture: 'environment' as const } : {})}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          e.target.value = '' // same file can be re-picked after an error
        }}
      />
    </div>
  )
}
