import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required."),
  password: z.string().min(1, "Password is required."),
});
export const resetRequestSchema = z.object({
  email: z.string().email("Enter a valid admin email address."),
});
export const resetSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit verification code."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});
export const locationImportSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  code: z.string().min(1),
  type: z.enum([
    "Building",
    "Floor",
    "Room",
    "Office",
    "Laboratory",
    "Restroom",
    "Facility",
  ]),
  parentId: z.string().nullable(),
  status: z.enum(["Active", "Inactive", "Open", "Closed"]),
  lat: z.number(),
  lng: z.number(),
});
export const routeImportSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  sourceNodeId: z.string(),
  destinationNodeId: z.string(),
  pathPoints: z.array(z.tuple([z.number(), z.number()])),
});
