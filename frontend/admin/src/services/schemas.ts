import { z } from "zod";

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
export const resetRequestSchema = z.object({
  username: z.string().min(1, "Username is required."),
});
export const resetSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit verification code."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});
export const resetPasswordSchema = resetSchema
  .extend({
    confirmPassword: z.string().min(8, "Confirm your new password."),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
const locationImportFields = z.object({
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
export const locationImportSchema = locationImportFields;
export const locationSchema = locationImportFields.extend({
  building: z.string().optional(),
  floor: z.string().optional(),
  function: z.string().optional(),
  keywords: z.string().optional(),
  positioned: z.boolean(),
});
export const routeImportSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  sourceNodeId: z.string(),
  destinationNodeId: z.string(),
  pathPoints: z.array(z.tuple([z.number(), z.number()])),
});
export const pathwaySchema = routeImportSchema.extend({
  distance: z.string(),
  time: z.string(),
  shade: z.enum(["Fully Shaded", "Mostly Shaded", "Partial Shade", "Unshaded", "Unknown"]),
  type: z.string().min(1),
  direction: z.enum(["Two-way", "One-way", "Unknown"]),
  status: z.enum(["Open", "Closed", "Unknown"]),
});
export const userAccountSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1, "Username is required."),
  createdAt: z.string().min(1),
  lastSignIn: z.string().nullable(),
  role: z.enum(["Administrator", "Staff", "User"]),
});
