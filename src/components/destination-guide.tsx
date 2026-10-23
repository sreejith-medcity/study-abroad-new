import Link from "next/link";
import { Card, CardHeader, DataList } from "@/components/ui";

/**
 * A destination guide as counsellors read it: an overview, the capital, the
 * languages, the climate, accommodation and the questions students ask.
 *
 * Everything here is plain text shown with its line breaks kept. None of it is
 * ever rendered as HTML: it came from the MIOC app or a form, and either could
 * carry markup nobody meant to run.
 */

export type GuideCountry = {
  code: string;
  name: string;
  guide: string | null;
  capital: string | null;
  languages: string | null;
  climate: string | null;
  accommodation: string | null;
  faqs: { question: string; answer: string }[] | null;
};

export const hasGuide = (c: GuideCountry) => !!(c.guide?.trim() || c.capital?.trim() || c.languages?.trim() || c.climate?.trim() || c.accommodation?.trim() || c.faqs?.length);

export const guideHref = (code: string) => `/destinations/${code}`;

function basics(c: GuideCountry) {
  return [
    c.capital?.trim() && { label: "Capital", value: c.capital },
    c.languages?.trim() && { label: "Languages", value: c.languages },
    c.climate?.trim() && { label: "Climate", value: c.climate },
  ].filter(Boolean) as { label: string; value: string }[];
}

/** The overview's first paragraph, for the short versions. */
const opening = (text: string | null) => text?.split(/\n\s*\n/)[0]?.trim() || null;

/** For the side of a program or university page: the basics and the start of the overview, with the way to the whole guide. */
export function DestinationSnapshot({ country }: { country: GuideCountry }) {
  if (!hasGuide(country)) return null;
  const rows = basics(country);
  const first = opening(country.guide);
  return (
    <Card data-destination-snapshot>
      <CardHeader title={`Studying in ${country.name}`} subtitle="From the destination guide" />
      {rows.length > 0 && <DataList rows={rows} />}
      {first && <p className="whitespace-pre-line border-t border-line px-4 py-3 text-sm leading-relaxed text-ink-soft">{first}</p>}
      <div className="border-t border-line px-4 py-3">
        <Link prefetch={false} href={guideHref(country.code)} className="text-sm font-medium text-brand-600 hover:underline">
          Read the {country.name} guide
        </Link>
      </div>
    </Card>
  );
}

/** One line above a list of a country's universities. */
export function DestinationStrip({ country }: { country: GuideCountry }) {
  if (!hasGuide(country)) return null;
  const rows = basics(country);
  return (
    <div data-destination-strip className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-line bg-surface px-4 py-3 text-sm shadow-card">
      <span className="font-semibold text-ink">{country.name}</span>
      {rows.map((r) => (
        <span key={r.label} className="text-ink-soft">
          <span className="text-muted">{r.label}:</span> {r.value}
        </span>
      ))}
      <Link prefetch={false} href={guideHref(country.code)} className="ml-auto font-medium text-brand-600 hover:underline">
        Destination guide
      </Link>
    </div>
  );
}

/** The whole guide. */
export function DestinationGuide({ country }: { country: GuideCountry }) {
  const rows = basics(country);
  const faqs = country.faqs ?? [];
  return (
    <div className="space-y-5" data-destination-guide>
      {(country.guide?.trim() || rows.length > 0) && (
        <Card>
          <CardHeader title={`About studying in ${country.name}`} />
          {rows.length > 0 && <DataList rows={rows} />}
          {country.guide?.trim() && <p className="whitespace-pre-line border-t border-line px-4 py-3 text-sm leading-relaxed text-ink-soft">{country.guide}</p>}
        </Card>
      )}
      {country.accommodation?.trim() && (
        <Card>
          <CardHeader title="Accommodation" />
          <p className="whitespace-pre-line px-4 py-3 text-sm leading-relaxed text-ink-soft">{country.accommodation}</p>
        </Card>
      )}
      {faqs.length > 0 && (
        <Card>
          <CardHeader title="Questions students ask" subtitle={`${faqs.length} answered`} />
          <ul className="divide-y divide-line">
            {faqs.map((f, i) => (
              <li key={i}>
                <details className="group px-4 py-3">
                  <summary className="cursor-pointer text-sm font-medium text-ink">{f.question}</summary>
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-soft">{f.answer}</p>
                </details>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
