"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { sendPasswordResetEmail } from "firebase/auth";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { firebaseAuth } from "@/lib/firebase";
import { resetPasswordSchema } from "@/lib/validators";

type Values = z.infer<typeof resetPasswordSchema>;

export function ResetPasswordForm() {
  const { showToast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(resetPasswordSchema), defaultValues: { email: "" } });

  async function onSubmit(values: Values) {
    setSubmitting(true);
    try {
      await sendPasswordResetEmail(firebaseAuth, values.email);
      showToast({ variant: "success", title: "Reset email sent", description: "Check your inbox for the secure reset link." });
    } catch {
      showToast({ variant: "error", title: "Reset email failed", description: "Check the email address and try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium">Email</label>
        <Input type="email" autoComplete="email" {...form.register("email")} />
        <p className="mt-1 min-h-5 text-xs text-coral">{form.formState.errors.email?.message}</p>
      </div>
      <Button className="w-full" disabled={submitting}>{submitting ? "Sending" : "Send reset link"}</Button>
      <Link className="block text-center text-sm text-ink/65 hover:text-ink dark:text-white/65 dark:hover:text-white" href="/login">Back to sign in</Link>
    </form>
  );
}
