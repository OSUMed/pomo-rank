import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { AuthForm } from "@/components/AuthForm";

export default async function LoginPage() {
  const session = await readSession();
  if (session) redirect("/dashboard");

  return (
    <main className="app-shell">
      <section className="timer-card auth-card">
        <header className="heading-block">
          <p className="eyebrow">Focus Toolkit</p>
          <h1>Pulse Pomodoro</h1>
          <p className="subtitle">Simple username/password auth with Supabase backend.</p>
        </header>
        <AuthForm />
      </section>
    </main>
  );
}
