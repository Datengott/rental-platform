"use client";

export default function FacilityPicker({
  name,
  options,
  selected,
  onChange,
}: {
  name: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  return (
    <div className="chip-group">
      {options.map((opt) => (
        <label key={opt.value} className={`chip ${selected.includes(opt.value) ? "chip-selected" : ""}`}>
          <input
            type="checkbox"
            name={name}
            value={opt.value}
            checked={selected.includes(opt.value)}
            onChange={() => toggle(opt.value)}
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}
