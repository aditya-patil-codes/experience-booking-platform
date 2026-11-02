import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import { seatsTaken } from "../src/services/bookings";
import { resetDb, loginAgent, setupSlot } from "./helpers";

describe("booking concurrency", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("50 parallel requests for 5 seats: exactly 5 succeed", async () => {
    const { slot } = await setupSlot(5);
    const customers = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        loginAgent("CUSTOMER", `c${i}@example.com`)
      )
    );

    const results = await Promise.all(
      customers.map((c) =>
        c.post("/bookings").send({ slotId: slot.id, seats: 1 })
      )
    );

    const ok = results.filter((r) => r.status === 201);
    const refused = results.filter((r) => r.status === 409);

    expect(ok).toHaveLength(5);
    expect(refused).toHaveLength(45);
    expect(refused.every((r) => r.body.error.code === "NOT_ENOUGH_SEATS")).toBe(
      true
    );
    expect(await seatsTaken(prisma, slot.id)).toBe(5);
  });

  it("20 parallel requests for 2 seats each on a 5 seat slot: exactly 2 succeed", async () => {
    const { slot } = await setupSlot(5);
    const customers = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        loginAgent("CUSTOMER", `d${i}@example.com`)
      )
    );

    const results = await Promise.all(
      customers.map((c) =>
        c.post("/bookings").send({ slotId: slot.id, seats: 2 })
      )
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(18);
    expect(await seatsTaken(prisma, slot.id)).toBe(4);
  });
});
