import express from "express";
import { prisma } from "./lib/prisma";
import { authRouter } from "./routes/auth";
import { notFound, errorHandler } from "./middleware/error";
import cookieParser from "cookie-parser";
import { requireAuth, requireRole } from "./middleware/auth";
import { experiencesRouter } from "./routes/experiences";

export const app = express();

app.use(express.json());
app.use(cookieParser());

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "up" });
  } catch {
    res.status(503).json({ status: "error", db: "down" });
  }
});


app.use("/auth", authRouter);
app.use("/experiences", experiencesRouter);

app.use(notFound);
app.use(errorHandler);