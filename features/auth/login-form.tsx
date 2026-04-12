"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { signInWithEmailAndPassword } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { ensureFirebasePersistence, firebaseAuth } from "@/lib/firebase";
import { loginSchema } from "@/lib/validators";

type Values = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const { showToast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  async function onSubmit(values: Values) {
    setSubmitting(true);
    try {
      await ensureFirebasePersistence();
      await signInWithEmailAndPassword(firebaseAuth, values.email, values.password);
      router.replace("/app");
    } catch {
      showToast({ variant: "error", title: "Sign in failed", description: "Check your email and password, then try again." });
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
      <div>
        <label className="mb-1 block text-sm font-medium">Password</label>
        <Input type="password" autoComplete="current-password" {...form.register("password")} />
        <p className="mt-1 min-h-5 text-xs text-coral">{form.formState.errors.password?.message}</p>
      </div>
      <Button className="w-full" disabled={submitting}>{submitting ? "Signing in" : "Sign in"}</Button>
      <div className="flex items-center justify-between text-sm text-ink/65 dark:text-white/65">
        <Link className="hover:text-ink dark:hover:text-white" href="/reset-password">Reset password</Link>
        <Link className="hover:text-ink dark:hover:text-white" href="/register">Create account</Link>
      </div>
    </form>
  );
}
