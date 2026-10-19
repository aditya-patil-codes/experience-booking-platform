import jwt from "jsonwebtoken";
import { AppError } from "../errors";
import { requireAuth } from "../middleware/auth";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { env } from "../config";
import { validateBody } from "../middleware/validate";

export const authRouter = Router();

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.NODE_ENV === "production"
};

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(72)
});

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

authRouter.post("/login", validateBody(loginSchema), async (req, res) => {
  const { email, password } = req.body as z.infer<typeof loginSchema>;

  const user = await prisma.user.findUnique({ where: { email } });
  const ok = user ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!user || !ok) {
    throw new AppError(401, "Invalid email or password", "INVALID CREDS");
  }

  const token = jwt.sign({ role: user.role }, env.JWT_SECRET, {
    subject: user.id,
    expiresIn: "7d"
  });

  res.cookie("token", token, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 100
  });
  res.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, name: true, email: true, role: true }
  });
  if(!user) throw new AppError(401, "Account no longer exists", "UNAUTHORIZED") ; 
  res.json({user})
});

authRouter.post("/logout", (_req,res)=>{
  res.clearCookie("token", cookieOptions) ; 
  res.status(204).end() ; 
})
