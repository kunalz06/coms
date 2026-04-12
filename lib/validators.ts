import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Password is required.")
});

export const registerSchema = z.object({
  fullName: z.string().min(2, "Enter your full name.").max(80),
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters.")
});

export const resetPasswordSchema = z.object({
  email: z.string().email("Enter a valid email address.")
});

export const accountSchema = z.object({
  email: z.string().email("Enter a valid email address.").optional().or(z.literal("")),
  password: z.string().min(8, "Use at least 8 characters.").optional().or(z.literal(""))
});

export const messageSchema = z.object({
  content: z.string().trim().max(4000, "Messages can be up to 4000 characters.")
});

export const searchSchema = z.object({
  email: z.string().email("Search by a full email address.")
});
