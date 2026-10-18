import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { env } from "../config";
import { validateBody } from "../middleware/validate";

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(72),
  role: z.enum(["CUSTOMER", "HOST"]).default("CUSTOMER")
});

authRouter.post("/register", validateBody(registerSchema), async (req, res) => {
  const { name, email, password, role } = req.body as z.infer<
    typeof registerSchema
  >;

  const passwordHash = await bcrypt.hash(
    password,
    env.NODE_ENV === "test" ? 4 : 12
  );

  const user = await prisma.user.create({
    data: { name, email, passwordHash, role },
    select: { id: true, name: true, email: true, role: true, createdAt: true }
  });

  res.status(201).json({ user });
});
