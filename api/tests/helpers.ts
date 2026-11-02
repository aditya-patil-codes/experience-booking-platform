import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/prisma";

export type Agent = ReturnType<typeof request.agent>;

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "LedgerEntry","Payment","Booking","Slot","Experience","User" RESTART IDENTITY CASCADE'
  );
}

export async function loginAgent(role: "HOST" | "CUSTOMER", email: string): Promise<Agent> {
  const agent = request.agent(app);
  await agent
    .post("/auth/register")
    .send({ name: "Test User", email, password: "password123", role })
    .expect(201);
  await agent.post("/auth/login").send({ email, password: "password123" }).expect(200);
  return agent;
}

export const futureDate = (days = 7) => new Date(Date.now() + days * 86_400_000).toISOString();

export const experiencePayload = (overrides: Record<string, unknown> = {}) => ({
  title: "Old Town Food Walk",
  description: "Three hours tasting local street food.",
  city: "Berlin",
  priceCents: 4500,
  durationMinutes: 180,
  ...overrides,
});

export async function createExperience(agent: Agent, overrides: Record<string, unknown> = {}) {
  const res = await agent.post("/experiences").send(experiencePayload(overrides)).expect(201);
  return res.body.experience as { id: string; hostId: string; priceCents: number };
}

export async function addSlot(agent: Agent, experienceId: string, days = 7, capacity = 8) {
  const res = await agent
    .post(`/experiences/${experienceId}/slots`)
    .send({ startsAt: futureDate(days), capacity })
    .expect(201);
  return res.body.slot as { id: string };
}

export async function setupSlot(capacity: number) {
  const host = await loginAgent("HOST", "priya@example.com");
  const exp = await createExperience(host);
  const slot = await addSlot(host, exp.id, 7, capacity);
  return { host, slot };
}