import { ResetPasswordForm } from "@/features/auth/reset-password-form";

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <section className="w-full max-w-md rounded-lg border border-line bg-paper/80 p-6 shadow-soft backdrop-blur dark:border-white/10 dark:bg-neutral-950/80">
        <div className="mb-8">
          <p className="text-sm font-semibold tracking-[0.16em] text-moss dark:text-emerald-300">COMMS</p>
          <h1 className="mt-3 text-3xl font-semibold text-ink dark:text-white">Reset password</h1>
          <p className="mt-2 text-sm text-ink/65 dark:text-white/65">We will send a secure reset link to your email.</p>
        </div>
        <ResetPasswordForm />
      </section>
    </main>
  );
}
