import { useEffect, useMemo, useRef, useState } from "react";

export interface PaletteCommand {
  id: string;
  label: string;
  category: string;
  action: () => void;
}

interface CommandPaletteProps {
  commands: PaletteCommand[];
  onClose: () => void;
}

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    return commands.filter((cmd) => fuzzyMatch(query, cmd.label) || fuzzyMatch(query, cmd.category));
  }, [commands, query]);

  const grouped = useMemo(() => {
    const groups: Record<string, PaletteCommand[]> = {};
    for (const cmd of filtered) {
      if (!groups[cmd.category]) groups[cmd.category] = [];
      groups[cmd.category]!.push(cmd);
    }
    return groups;
  }, [filtered]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector(".command-item.selected");
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const executeSelected = () => {
    if (filtered[selectedIndex]) {
      filtered[selectedIndex].action();
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      executeSelected();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  let flatIndex = 0;

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="command-palette-input"
          type="text"
          placeholder="Type a command..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="command-palette-list" ref={listRef}>
          {Object.entries(grouped).map(([category, cmds]) => (
            <div key={category}>
              <div className="command-category">{category}</div>
              {cmds.map((cmd) => {
                const idx = flatIndex++;
                return (
                  <button
                    key={cmd.id}
                    type="button"
                    className={`command-item${idx === selectedIndex ? " selected" : ""}`}
                    onClick={() => { cmd.action(); onClose(); }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    {cmd.label}
                  </button>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="command-empty">No matching commands</div>
          )}
        </div>
      </div>
    </div>
  );
}
