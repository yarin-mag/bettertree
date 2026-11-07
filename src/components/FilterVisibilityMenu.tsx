import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";

interface FilterDef {
  key: string;
  label: string;
}

interface FilterVisibilityMenuProps {
  filters: FilterDef[];
  visible: string[];
  onToggle: (key: string) => void;
}

export default function FilterVisibilityMenu({ filters, visible, onToggle }: FilterVisibilityMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className="px-2 py-1 rounded border border-border-subtle text-text-muted hover:text-text-primary hover:border-accent flex items-center gap-1"
        onClick={() => setIsOpen((o) => !o)}
      >
        <SlidersHorizontal size={12} />
        Filters
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 z-20 mt-1 w-48 bg-elevated border border-border-subtle rounded-lg shadow-lg p-1 animate-pop-in">
          {filters.map((f) => (
            <label
              key={f.key}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm text-text-primary hover:bg-accent-soft"
            >
              <input type="checkbox" checked={visible.includes(f.key)} onChange={() => onToggle(f.key)} />
              {f.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
