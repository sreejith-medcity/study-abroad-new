import { LinkButton } from "@/components/ui";

export default function Forbidden() {
  return (
    <main className="grid min-h-screen place-items-center px-4 text-center">
      <div>
        <h1 className="text-xl font-semibold">You don't have access to that page</h1>
        <p className="mt-1 text-muted">Ask a Medcity Overseas admin if you think you should.</p>
        <LinkButton href="/" className="mt-4">Go to my home page</LinkButton>
      </div>
    </main>
  );
}
