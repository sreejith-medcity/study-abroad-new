import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Card } from "@/components/ui";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-2xl font-bold tracking-tight text-brand-600">medcity overseas</p>
          <p className="text-muted">Partner and team portal</p>
        </div>
        <Card className="p-6">
          <LoginForm />
        </Card>
        {process.env.NODE_ENV !== "production" && (
          <p className="mt-4 text-center text-xs text-muted">
            Dev accounts: admin@medcityoverseas.test, uk.docs@medcity.test · Password@123
          </p>
        )}
      </div>
    </main>
  );
}
