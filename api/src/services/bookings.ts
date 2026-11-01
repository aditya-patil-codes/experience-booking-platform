import { prisma } from "../lib/prisma";
import { AppError } from "../errors";
import type { Prisma } from "../../generated/prisma/client";

export const HOLD_MINUTES = 15;

export async function seatsTaken(
  db: Prisma.TransactionClient,
  slotId: string,
  now = new Date()
) {
  const result = await db.booking.aggregate({
    _sum: { seats: true },
    where: {
      slotId,
      OR: [
        { status: { in: ["PAID", "CONFIRMED"] } },
        { status: "PENDING", expiresAt: { gt: now } }
      ]
    }
  });
  return result._sum.seats ?? 0;
}

export async function createBooking(
  userId: string,
  slotId: string,
  seats: number
) {
  return prisma.$transaction(
    async (tx) => {
      // 1. Lock this slot's row. Other bookings for the same slot wait here.

      const locked = await tx.$queryRaw<
        { id: string; capacity: number; startsAt: Date }[]
      >`SELECT id, capacity, "startsAt" FROM "Slot" WHERE id = ${slotId} FOR UPDATE `;

      const slot = locked[0];
      if (!slot) throw new AppError(404, " Slot not Found", "NOT_FOUND");
      if (slot.startsAt.getTime() <= Date.now()) {
        throw new AppError(409, "This slot has already started", "SLOT_CLOSED");
      }

      const now = new Date();

      // 2. release holds that ran out of time
      await tx.booking.updateMany({
        where: { slotId, status: "PENDING", expiresAt: { lt: now } },
        data: { status: "CANCELLED" }
      });

      //3 . Count the seats that are still taken
      const taken = await seatsTaken(tx, slotId, now);

      const left = slot.capacity - taken;
      if (seats > left) {
        throw new AppError(
          409,
          left > 0
            ? `Only ${left} 
                    seat(s) left`
            : "This slot is solt out",
          "NOT_ENOUGH_SEATS"
        );
      }

      // 4 . Create the hold
      return tx.booking.create({
        data: {
          userId,
          slotId,
          seats,
          status: "PENDING",
          expiresAt: new Date(now.getTime() + HOLD_MINUTES * 60_000)
        }
      });
    },
    { maxWait: 10_000, timeout: 15_000 }
  );
}

export async function cancelBooking(userId: string, bookingId: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.userId !== userId) {
    throw new AppError(404, "Booking not found", "NOT_FOUND");
  }
  if (booking.status !== "PENDING") {
    throw new AppError(
      409,
      "Only unpaid holds can be cancelled for now",
      "CANNOT_CANCEL"
    );
  }
  return prisma.booking.update({
    where: { id: bookingId },
    data: { status: "CANCELLED" }
  });
}

export function withEffectiveStatus<
  T extends { status: string; expiresAt: Date | null }
>(b: T) {
  const expired =
    b.status === "PENDING" && b.expiresAt !== null && b.expiresAt < new Date();
  return { ...b, status: expired ? "EXPIRED" : b.status };
}
