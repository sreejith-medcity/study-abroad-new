import { LinkButton, Logo } from "@/components/ui";

export const metadata = { title: "No access" };

export default function Forbidden() {
  return (
    <main className="grid min-h-screen place-items-center px-4 text-center">
      <div>
        <Logo tone="dark" className="mx-auto" />
        <h1 className="mt-8 font-display text-xl font-semibold">That page isn&apos;t open to your role</h1>
        <p className="mt-1 text-muted">Ask a Medcity Overseas admin if you think it should be.</p>
        <LinkButton href="/" className="mt-5">
          Go to my home page
        </LinkButton>
      </div>
    </main>
  );
}
