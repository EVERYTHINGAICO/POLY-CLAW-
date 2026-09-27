import { useEffect, useRef, useState } from "react";

interface AnnotationEditorProps {
  nodeId: string;
  nodeLabel: string;
  initialText: string;
  position: { x: number; y: number };
  onSave: (nodeId: string, text: string) => void;
  onDelete: (nodeId: string) => void;
  onClose: () => void;
}

export function AnnotationEditor({ nodeId, nodeLabel, initialText, position, onSave, onDelete, onClose }: AnnotationEditorProps) {
  const [text, setText] = useState(initialText);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      className="annotation-editor"
      style={{ left: position.x + 16, top: position.y + 16 }}
    >
      <div className="annotation-editor-title">{nodeLabel}</div>
      <textarea
        ref={inputRef}
        className="annotation-editor-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a note..."
        rows={3}
      />
      <div className="annotation-editor-actions">
        <button
          type="button"
          className="annotation-btn save"
          onClick={() => { onSave(nodeId, text); onClose(); }}
        >
          Save
        </button>
        {initialText && (
          <button
            type="button"
            className="annotation-btn delete"
            onClick={() => { onDelete(nodeId); onClose(); }}
          >
            Delete
          </button>
        )}
        <button type="button" className="annotation-btn cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
