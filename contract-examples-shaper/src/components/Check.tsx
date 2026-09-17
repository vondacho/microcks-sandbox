import { useEffect, useRef } from 'react';

interface Props {
  /** What the box stands for: checked when all are selected, indeterminate when some are. */
  leaves: string[];
  selected: ReadonlySet<string>;
  onToggle: (leaves: string[], checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

/** A checkbox over a set of items. With nothing to select it keeps its place in the row, empty. */
export function Check({ leaves, selected, onToggle, label, disabled }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const count = leaves.filter((leaf) => selected.has(leaf)).length;
  const checked = leaves.length > 0 && count === leaves.length;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = count > 0 && !checked;
  }, [count, checked]);
  if (leaves.length === 0) return <span className="check-placeholder" aria-hidden="true" />;
  return (
    <input ref={ref} type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={() => onToggle(leaves, !checked)} />
  );
}
