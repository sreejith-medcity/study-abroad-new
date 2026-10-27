import { countryCell } from "@/lib/student-list";
import { cn } from "@/components/ui";

/**
 * Where a student is applying, as the students list shows it: the countries
 * of their applications, or, when they have none, the country they said they
 * would prefer, set lighter and marked so it is not read as an application.
 *
 * Drawn in its own column on a wide screen and as a line under the programmes
 * on a laptop, where a column of its own would push the status off the right.
 * One component, so the two can never word it differently.
 */
export function CountryNames({ applied, preferred, inline = false, className }: { applied: string[]; preferred: string | null; inline?: boolean; className?: string }) {
  const cell = countryCell(applied, preferred);
  if (!cell.names.length) return inline ? null : <span className={cn("text-xs text-muted/70", className)}>Not given</span>;
  if (cell.preference) {
    return (
      <span className={cn("block italic text-muted/80", className)} title="Preferred country: no applications yet">
        {inline ? `Prefers ${cell.names[0]}` : cell.names[0]}
        {!inline && <span className="block text-2xs not-italic text-muted/70">Preferred</span>}
      </span>
    );
  }
  return inline ? (
    <span className={cn("block truncate", className)} title={cell.names.join(", ")}>{cell.names.join(", ")}</span>
  ) : (
    <span className={cn("block", className)} title={cell.names.join(", ")}>
      {cell.names.map((n) => (
        <span key={n} className="block truncate">{n}</span>
      ))}
    </span>
  );
}
