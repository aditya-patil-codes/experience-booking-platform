import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { resetDb, loginAgent, createExperience, addSlot } from "./helpers";

async function setup(capacity: number) {
  const host = await loginAgent("HOST", "priya@example.com");
  const exp = await createExperience(host);
  const slot = await addSlot(host, exp.id, 7, capacity);
  return { host, slot };
}

describe("bookings", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("requires login", async () => {
    const res = await request(app).post("/bookings").send({});
    expect(res.status).toBe(401);
  });

  it("does not let hosts book", async () => {
    const { host, slot } = await setup(4);
    const res = await host.post("/bookings").send({ slotId: slot.id, seats: 1 });
    expect(res.status).toBe(403);
  });

  it("creates a 15-minute hold", async () => {
    const { slot } = await setup(4);
    const customer = await loginAgent("CUSTOMER", "rahul@example.com");
    const res = await customer.post("/bookings").send({ slotId: slot.id, seats: 2 });
    expect(res.status).toBe(201);
    expect(res.body.booking.status).toBe("PENDING");
    const minutes = (new Date(res.body.booking.expiresAt).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);
  });

  it("refuses more seats than the capacity", async () => {
    const { slot } = await setup(2);
    const customer = await loginAgent("CUSTOMER", "rahul@example.com");
    const res = await customer.post("/bookings").send({ slotId: slot.id, seats: 3 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NOT_ENOUGH_SEATS");
  });

  it("refuses a booking when the slot is sold out", async () => {
    const { slot } = await setup(2);
    const a = await loginAgent("CUSTOMER", "a@example.com");
    const b = await loginAgent("CUSTOMER", "b@example.com");
    await a.post("/bookings").send({ slotId: slot.id, seats: 2 }).expect(201);
    const res = await b.post("/bookings").send({ slotId: slot.id, seats: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NOT_ENOUGH_SEATS");
  });

  it("frees the seats when a hold expires", async () => {
    const { slot } = await setup(1);
    const a = await loginAgent("CUSTOMER", "a@example.com");
    const b = await loginAgent("CUSTOMER", "b@example.com");
    const first = await a.post("/bookings").send({ slotId: slot.id, seats: 1 }).expect(201);
    await prisma.booking.update({
      where: { id: first.body.booking.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await b.post("/bookings").send({ slotId: slot.id, seats: 1 }).expect(201);
  });

  it("frees the seats when a hold is cancelled", async () => {
    const { slot } = await setup(1);
    const a = await loginAgent("CUSTOMER", "a@example.com");
    const b = await loginAgent("CUSTOMER", "b@example.com");
    const first = await a.post("/bookings").send({ slotId: slot.id, seats: 1 }).expect(201);
    await a.post(`/bookings/${first.body.booking.id}/cancel`).expect(200);
    await b.post("/bookings").send({ slotId: slot.id, seats: 1 }).expect(201);
  });

  it("does not let someone cancel another person's booking", async () => {
    const { slot } = await setup(2);
    const a = await loginAgent("CUSTOMER", "a@example.com");
    const b = await loginAgent("CUSTOMER", "b@example.com");
    const first = await a.post("/bookings").send({ slotId: slot.id, seats: 1 }).expect(201);
    const res = await b.post(`/bookings/${first.body.booking.id}/cancel`);
    expect(res.status).toBe(404);
  });

  it("does not cancel a paid booking", async () => {
    const { slot } = await setup(2);
    const a = await loginAgent("CUSTOMER", "a@example.com");
    const first = await a.post("/bookings").send({ slotId: slot.id, seats: 1 }).expect(201);
    await prisma.booking.update({ where: { id: first.body.booking.id }, data: { status: "PAID" } });
    const res = await a.post(`/bookings/${first.body.booking.id}/cancel`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CANNOT_CANCEL");
  });

  it("shows an expired hold as EXPIRED in my bookings", async () => {
    const { slot } = await setup(2);
    const a = await loginAgent("CUSTOMER", "a@example.com");
    const first = await a.post("/bookings").send({ slotId: slot.id, seats: 1 }).expect(201);
    await prisma.booking.update({
      where: { id: first.body.booking.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const res = await a.get("/bookings/mine");
    expect(res.status).toBe(200);
    expect(res.body.bookings[0].status).toBe("EXPIRED");
  });
});