import Link from "next/link";
import { RegisterForm } from "@/features/auth/register-form";

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <section className="w-full max-w-md rounded-lg border border-line bg-paper/80 p-6 shadow-soft backdrop-blur dark:border-white/10 dark:bg-neutral-950/80">
        <div className="mb-8">
          <p className="text-sm font-semibold tracking-[0.16em] text-moss dark:text-emerald-300">COMMS</p>
          <h1 className="mt-3 text-3xl font-semibold text-ink dark:text-white">Create account</h1>
          <p className="mt-2 text-sm text-ink/65 dark:text-white/65">Start with your name, email, and a secure password.</p>
        </div>
        <RegisterForm />
        <Link className="mt-4 block text-center text-sm text-ink/65 hover:text-ink dark:text-white/65 dark:hover:text-white" href="/login">Already have an account?</Link>
      </section>
    </main>
  );
}
