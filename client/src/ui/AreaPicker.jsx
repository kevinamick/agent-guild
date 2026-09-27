import { useEffect, useMemo, useRef, useState } from 'react';
import { searchAreas } from './areaSearch.js';

// A searchable area-path filter: type any part of a path, pick with the mouse or
// arrows + Enter. Esc closes the list without closing the board.
export function AreaPicker({ areas, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef();
  const results = useMemo(() => searchAreas(areas, query), [areas, query]);
  const options = query.trim() ? results : ['', ...results]; // '' = All areas

  useEffect(() => setActive(0), [query, open]);
  useEffect(() => {
    if (!open) return;
    const away = (e) => !box.current?.contains(e.target) && setOpen(false);
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);
  useEffect(() => {
    box.current?.querySelector('.area-option.on')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (area) => {
    onChange(area);
    setQuery('');
    setOpen(false);
  };

  const onKey = (e) => {
    e.stopPropagation(); // the board's own Esc and the game's keys stay out of this
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && options.length) choose(options[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
      e.currentTarget.blur();
    }
  };

  const label = value ? value.split('\\').pop() : 'All areas';
  return (
    <div className="area-picker" ref={box}>
      <span className="muted small">Area</span>
      <input
        className="input area-search"
        role="combobox"
        aria-expanded={open}
        aria-controls="area-options"
        aria-label="Search area paths"
        title={value || 'All areas'}
        placeholder={open ? 'Search area paths…' : label}
        value={open ? query : label}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKey}
      />
      {value && !open && (
        <button className="icon-btn" title="Show all areas" aria-label="Clear area filter" onClick={() => choose('')}>
          ×
        </button>
      )}
      {open && (
        <div className="area-options panel" id="area-options" role="listbox">
          {options.length === 0 && <div className="muted small pad">No area matches “{query}”.</div>}
          {options.map((a, i) => {
            const parts = a.split('\\');
            return (
              <div
                key={a || '(all)'}
                role="option"
                aria-selected={a === value}
                className={`area-option ${i === active ? 'on' : ''} ${a === value ? 'current' : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus until chosen
                  choose(a);
                }}
              >
                {a ? (
                  <>
                    <b>{parts[parts.length - 1]}</b>
                    {parts.length > 1 && <span className="muted small"> {parts.slice(0, -1).join(' › ')}</span>}
                  </>
                ) : (
                  <b>All areas</b>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
