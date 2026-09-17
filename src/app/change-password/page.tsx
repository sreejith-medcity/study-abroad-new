import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Alert, Card } from "@/components/ui";
import { logoutAction } from "@/app/login/actions";
import { ChangePasswordForm } from "./form";

export const metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-2xl font-bold tracking-tight text-brand-600">medcity overseas</p>
          <p className="text-muted">Signed in as {user.email}</p>
        </div>
        <Card className="space-y-4 p-6">
          {user.mustChangePassword && <Alert tone="info">Your account uses a temporary password. Set your own to continue.</Alert>}
          <ChangePasswordForm />
        </Card>
        <form action={logoutAction} className="mt-4 text-center">
          <button className="text-sm text-muted hover:text-ink">Sign out instead</button>
        </form>
      </div>
    </main>
  );
}
