import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AppError } from "../errors";
import { requireAuth, requireRole } from "../middleware/auth";
import { validateBody } from "../middleware/validate";

export const experiencesRouter = Router();

const idSchema = z.uuid()
const currencySchema = z.enum(["EUR","USD","INR","GBP"])

const baseSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(5000),
  city: z.string().trim().min(2).max(80),
  priceCents: z.number().int().min(0).max(1_000_000),
  currency: currencySchema,
  durationMinutes: z.number().int().min(15).max(1440),
});

const createSchema = baseSchema.extend({
    currency: currencySchema.default("EUR")
})

const updateSchema = baseSchema.partial().refine((v)=> Object.keys(v).length >0 , "Provide at least one Field")

const slotSchema = z.object({
    startsAt:z.coerce.date().refine((d)=>d.getTime()>Date.now(),"startsAt must me in the future"),
    capacity: z.number().int().min(1).max(200)
})


async function getOwnedExperience(id: string, userId: string) {
  const experience = await prisma.experience.findUnique({ where: { id } });
  if (!experience) throw new AppError(404, "Experience not found", "NOT_FOUND");
  if (experience.hostId !== userId) {
    throw new AppError(403, "This is not your experience", "FORBIDDEN");
  }
  return experience;
}

// Create (host only)
experiencesRouter.post(
  "/",
  requireAuth,
  requireRole("HOST"),
  validateBody(createSchema),
  async (req, res) => {
    const data = req.body as z.infer<typeof createSchema>;
    const experience = await prisma.experience.create({
      data: { ...data, hostId: req.user!.id },
    });
    res.status(201).json({ experience });
  }
);


// List my own experiences (host only). Must be defined before "/:id".
experiencesRouter.get("/mine", requireAuth, requireRole("HOST"), async (req, res) => {
  const experiences = await prisma.experience.findMany({
    where: { hostId: req.user!.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { slots: true } } },
  });
  res.json({ experiences });
});


// Public detail with upcoming slots
experiencesRouter.get("/:id", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const experience = await prisma.experience.findUnique({
    where: { id },
    include: {
      host: { select: { id: true, name: true } },
      slots: { where: { startsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" } },
    },
  });
  if (!experience) throw new AppError(404, "Experience not found", "NOT_FOUND");
  res.json({ experience });
});

// Update (owner only)
experiencesRouter.patch(
  "/:id",
  requireAuth,
  requireRole("HOST"),
  validateBody(updateSchema),
  async (req, res) => {
    const id = idSchema.parse(req.params.id);
    await getOwnedExperience(id, req.user!.id);
    const experience = await prisma.experience.update({ where: { id }, data: req.body });
    res.json({ experience });
  }
);

// Delete (owner only, blocked if anyone has booked)
experiencesRouter.delete("/:id", requireAuth, requireRole("HOST"), async (req, res) => {
  const id = idSchema.parse(req.params.id);
  await getOwnedExperience(id, req.user!.id);

  const bookings = await prisma.booking.count({ where: { slot: { experienceId: id } } });
  if (bookings > 0) {
    throw new AppError(409, "Cannot delete an experience that has bookings", "HAS_BOOKINGS");
  }

  await prisma.$transaction([
    prisma.slot.deleteMany({ where: { experienceId: id } }),
    prisma.experience.delete({ where: { id } }),
  ]);
  res.status(204).end();
});

// Add a slot (owner only)
experiencesRouter.post(
  "/:id/slots",
  requireAuth,
  requireRole("HOST"),
  validateBody(slotSchema),
  async (req, res) => {
    const id = idSchema.parse(req.params.id);
    await getOwnedExperience(id, req.user!.id);
    const { startsAt, capacity } = req.body as z.infer<typeof slotSchema>;
    const slot = await prisma.slot.create({ data: { experienceId: id, startsAt, capacity } });
    res.status(201).json({ slot });
  }
);

// Delete a slot (owner only, blocked if booked)
experiencesRouter.delete(
  "/:id/slots/:slotId",
  requireAuth,
  requireRole("HOST"),
  async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const slotId = idSchema.parse(req.params.slotId);
    await getOwnedExperience(id, req.user!.id);

    const slot = await prisma.slot.findFirst({ where: { id: slotId, experienceId: id } });
    if (!slot) throw new AppError(404, "Slot not found", "NOT_FOUND");

    const bookings = await prisma.booking.count({ where: { slotId } });
    if (bookings > 0) {
      throw new AppError(409, "Cannot delete a slot that has bookings", "HAS_BOOKINGS");
    }

    await prisma.slot.delete({ where: { id: slotId } });
    res.status(204).end();
  }
);