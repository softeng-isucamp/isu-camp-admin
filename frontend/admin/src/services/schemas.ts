import { z } from "zod";
import { passwordRules } from "./passwordRules";

const locationTypeSchema = z.enum([
  "Building",
  "Floor",
  "Room",
  "Office",
  "Laboratory",
  "Restroom",
  "Facility",
]);
const recordStatusSchema = z.enum(["Active", "Inactive", "Open", "Closed", "Unknown"]);

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required."),
  password: z.string().min(1, "Password is required."),
});
export const recoveryEmailSchema = z.string().trim().email("Enter a valid email address.");
/** Every unmet rule is reported, in checklist order. */
export const passwordSchema = z.string().superRefine((password, ctx) => {
  for (const rule of passwordRules) {
    if (!rule.test(password)) ctx.addIssue({ code: "custom", message: rule.message });
  }
});
export const resetSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit verification code."),
  password: passwordSchema,
});
export const resetPasswordSchema = resetSchema
  .extend({
    confirmPassword: z.string().min(1, "Confirm your new password."),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
const locationFields = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  code: z.string().min(1),
  type: locationTypeSchema,
  parentId: z.string().nullable(),
  building: z.string().optional(),
  floor: z.string().optional(),
  status: recordStatusSchema,
  lat: z.number().nullable(),
  lng: z.number().nullable(),
});
export const locationSchema = locationFields.extend({
  building: z.string().optional(),
  floor: z.string().optional(),
  function: z.string().optional(),
  keywords: z.string().optional(),
  positioned: z.boolean(),
  polygonCoordinates: z.array(z.tuple([z.number(), z.number()])).optional(),
  photo: z.object({ name: z.string(), type: z.string(), dataUrl: z.string() }).optional(),
});
