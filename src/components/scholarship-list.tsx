import { fmtDate } from "@/lib/format";
import { LEVEL_LABEL } from "@/lib/catalogue";
import { Card, CardHeader } from "./ui";

type Row = { id: string; name: string; amount: string; levels: string[]; eligibility: string | null; deadline: string | null; url: string };

/** Open scholarships, each linking to the institution's own page for it. */
export function ScholarshipList({ rows, subtitle }: { rows: Row[]; subtitle?: string }) {
  if (!rows.length) return null;
  return (
    <Card>
      <CardHeader title="Scholarships" subtitle={subtitle ?? "Verified on the institution's own page. Check the page before promising one."} />
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="px-4 py-3 text-[13px]">
            <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-medium text-ink hover:text-brand-700 hover:underline">{r.name} ↗</a>
            <p className="font-medium text-good-700">{r.amount}</p>
            {r.eligibility && <p className="text-muted">{r.eligibility}</p>}
            <p className="text-xs text-muted">
              {r.levels.length ? r.levels.map((l) => LEVEL_LABEL[l] ?? l).join(", ") : "All levels"}
              {" · "}
              {r.deadline ? `Deadline ${fmtDate(r.deadline)}` : "No deadline published"}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
