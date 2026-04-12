"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { Camera } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { ensureFirebasePersistence, firebaseAuth } from "@/lib/firebase";
import { registerSchema } from "@/lib/validators";
import { uploadToCloudinary } from "@/services/upload-service";

type Values = z.infer<typeof registerSchema>;

export function RegisterForm() {
  const router = useRouter();
  const { showToast } = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [avatar, setAvatar] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const form = useForm<Values>({ resolver: zodResolver(registerSchema), defaultValues: { fullName: "", email: "", password: "" } });

  async function onSubmit(values: Values) {
    setSubmitting(true);
    try {
      await ensureFirebasePersistence();
      const credential = await createUserWithEmailAndPassword(firebaseAuth, values.email, values.password);
      let avatarUrl: string | null = null;
      if (avatar) {
        const result = await uploadToCloudinary({
          file: avatar,
          kind: "avatar",
          getIdToken: () => credential.user.getIdToken(),
          onProgress: setProgress
        });
        avatarUrl = result.url;
      }
      await updateProfile(credential.user, { displayName: values.fullName, photoURL: avatarUrl });
      router.replace("/app");
    } catch (error) {
      showToast({
        variant: "error",
        title: "Account was not created",
        description: error instanceof Error ? error.message : "Try again in a moment."
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="flex w-full items-center gap-3 rounded-lg border border-dashed border-line bg-white/60 p-3 text-left text-sm transition hover:bg-white dark:border-white/10 dark:bg-white/10 dark:hover:bg-white/15"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-moss/10 text-moss dark:bg-white/10 dark:text-white">
          <Camera className="h-5 w-5" />
        </span>
        <span>
          <span className="block font-medium">{avatar ? avatar.name : "Profile picture"}</span>
          <span className="text-ink/60 dark:text-white/60">Optional JPG, PNG, WebP, or GIF</span>
        </span>
      </button>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => setAvatar(event.target.files?.[0] ?? null)} />
      {progress > 0 && progress < 100 ? <div className="h-1 rounded-full bg-ink/10"><div className="h-full rounded-full bg-moss" style={{ width: `${progress}%` }} /></div> : null}
      <div>
        <label className="mb-1 block text-sm font-medium">Full name</label>
        <Input autoComplete="name" {...form.register("fullName")} />
        <p className="mt-1 min-h-5 text-xs text-coral">{form.formState.errors.fullName?.message}</p>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Email</label>
        <Input type="email" autoComplete="email" {...form.register("email")} />
        <p className="mt-1 min-h-5 text-xs text-coral">{form.formState.errors.email?.message}</p>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Password</label>
        <Input type="password" autoComplete="new-password" {...form.register("password")} />
        <p className="mt-1 min-h-5 text-xs text-coral">{form.formState.errors.password?.message}</p>
      </div>
      <Button className="w-full" disabled={submitting}>{submitting ? "Creating account" : "Create account"}</Button>
    </form>
  );
}
