import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AppError } from "../errors";
import { requireAuth, requireRole } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import type { Prisma } from "../../generated/prisma/client";

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


const listSchema = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    city: z.string().trim().min(1).max(80).optional(),
    minPrice: z.coerce.number().int().min(0).optional(),
    maxPrice: z.coerce.number().int().min(0).optional(),
    maxDuration: z.coerce.number().int().min(15).max(1440).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    sort: z.enum(["newest", "price_asc", "price_desc"]).default("newest"),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(12),
  })
  .refine((v) => v.minPrice === undefined || v.maxPrice === undefined || v.minPrice <= v.maxPrice, {
    message: "minPrice must be <= maxPrice",
  });

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


// Public search: GET /experiences?q=food&city=Berlin&maxPrice=6000&sort=price_asc&page=1
experiencesRouter.get("/", async (req, res) => {
  const f = listSchema.parse(req.query);
  const now = new Date();

  const where: Prisma.ExperienceWhereInput = {
    ...(f.city && { city: f.city }),
    ...(f.maxDuration && { durationMinutes: { lte: f.maxDuration } }),
    ...((f.minPrice !== undefined || f.maxPrice !== undefined) && {
      priceCents: {
        ...(f.minPrice !== undefined && { gte: f.minPrice }),
        ...(f.maxPrice !== undefined && { lte: f.maxPrice }),
      },
    }),
    ...(f.q && {
      OR: [
        { title: { contains: f.q, mode: "insensitive" } },
        { description: { contains: f.q, mode: "insensitive" } },
      ],
    }),
    slots: {
      some: { startsAt: { gte: f.from ?? now, ...(f.to && { lte: f.to }) } },
    },
  };

  const orderBy: Prisma.ExperienceOrderByWithRelationInput[] =
    f.sort === "price_asc"
      ? [{ priceCents: "asc" }, { id: "asc" }]
      : f.sort === "price_desc"
        ? [{ priceCents: "desc" }, { id: "asc" }]
        : [{ createdAt: "desc" }, { id: "asc" }];

  const [total, items] = await prisma.$transaction([
    prisma.experience.count({ where }),
    prisma.experience.findMany({
      where,
      orderBy,
      skip: (f.page - 1) * f.limit,
      take: f.limit,
      select: {
        id: true,
        title: true,
        city: true,
        priceCents: true,
        currency: true,
        durationMinutes: true,
        host: { select: { name: true } },
        slots: {
          where: { startsAt: { gte: now } },
          orderBy: { startsAt: "asc" },
          take: 1,
          select: { startsAt: true },
        },
      },
    }),
  ]);

  res.json({
    items,
    page: f.page,
    limit: f.limit,
    total,
    totalPages: Math.ceil(total / f.limit),
  });
});



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