import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/prisma";
import {
  resetDb, loginAgent, createExperience, addSlot, experiencePayload
} from "./helpers";

describe("experiences", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("requires login to create an experience", async () => {
    const res = await request(app).post("/experiences").send(experiencePayload());
    expect(res.status).toBe(401);
  });

  it("forbids customers from creating experiences", async () => {
    const customer = await loginAgent("CUSTOMER", "rahul@example.com");
    const res = await customer.post("/experiences").send(experiencePayload());
    expect(res.status).toBe(403);
  });

  it("lets a host create an experience", async () => {
    const host = await loginAgent("HOST", "priya@example.com");
    const res = await host.post("/experiences").send(experiencePayload());
    expect(res.status).toBe(201);
    expect(res.body.experience.title).toBe("Old Town Food Walk");
  });

  it("rejects a negative price", async () => {
    const host = await loginAgent("HOST", "priya@example.com");
    const res = await host.post("/experiences").send(experiencePayload({ priceCents: -5 }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("stops another host from editing someone else's experience", async () => {
    const owner = await loginAgent("HOST", "priya@example.com");
    const other = await loginAgent("HOST", "other@example.com");
    const exp = await createExperience(owner);
    const res = await other.patch(`/experiences/${exp.id}`).send({ priceCents: 1 });
    expect(res.status).toBe(403);
  });

  it("lets the owner update the price", async () => {
    const owner = await loginAgent("HOST", "priya@example.com");
    const exp = await createExperience(owner);
    const res = await owner.patch(`/experiences/${exp.id}`).send({ priceCents: 5000 });
    expect(res.status).toBe(200);
    expect(res.body.experience.priceCents).toBe(5000);
  });

  it("rejects a slot in the past", async () => {
    const host = await loginAgent("HOST", "priya@example.com");
    const exp = await createExperience(host);
    const res = await host
      .post(`/experiences/${exp.id}/slots`)
      .send({ startsAt: "2020-01-01T10:00:00Z", capacity: 8 });
    expect(res.status).toBe(400);
  });

  it("search filters by city", async () => {
    const host = await loginAgent("HOST", "priya@example.com");
    const berlin = await createExperience(host, { city: "Berlin" });
    const paris = await createExperience(host, { city: "Paris" });
    await addSlot(host, berlin.id);
    await addSlot(host, paris.id);
    const res = await request(app).get("/experiences?city=Berlin");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].city).toBe("Berlin");
  });

  it("search paginates results", async () => {
    const host = await loginAgent("HOST", "priya@example.com");
    for (let i = 0; i < 3; i++) {
      const exp = await createExperience(host, { title: `Walk number ${i + 1}` });
      await addSlot(host, exp.id, 7 + i);
    }
    const res = await request(app).get("/experiences?limit=2&page=1");
    expect(res.body.items).toHaveLength(2);
    expect(res.body.total).toBe(3);
    expect(res.body.totalPages).toBe(2);
  });

  it("rejects an oversized page limit", async () => {
    const res = await request(app).get("/experiences?limit=1000");
    expect(res.status).toBe(400);
  });

  it("hides experiences that have no upcoming slot", async () => {
    const host = await loginAgent("HOST", "priya@example.com");
    await createExperience(host);
    const res = await request(app).get("/experiences");
    expect(res.body.total).toBe(0);
  });

  it("blocks deleting an experience that has bookings", async () => {
    const host = await loginAgent("HOST", "priya@example.com");
    const customer = await loginAgent("CUSTOMER", "rahul@example.com");
    const exp = await createExperience(host);
    const slot = await addSlot(host, exp.id);
    const me = await customer.get("/auth/me");
    await prisma.booking.create({ data: { userId: me.body.user.id, slotId: slot.id, seats: 1 } });
    const res = await host.delete(`/experiences/${exp.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("HAS_BOOKINGS");
  });
});