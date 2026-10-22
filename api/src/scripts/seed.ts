import "dotenv/config";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";

// Small seeded random generator, so every run produces the same data
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

const cities = ["Berlin", "Munich", "Hamburg", "Cologne", "Frankfurt", "Dublin", "Amsterdam", "Paris", "Barcelona", "Lisbon"];
const activities = ["Food Walk", "Street Art Tour", "Pottery Workshop", "Bike Tour", "Cooking Class", "Photography Walk", "Wine Tasting", "Kayak Trip", "History Walk", "Coffee Roasting Class", "Sunrise Hike", "Boat Cruise"];
const adjectives = ["Hidden", "Classic", "Local", "Evening", "Morning", "Family", "Private", "Sunset", "Historic", "Secret"];
const durations = [60, 90, 120, 180, 240, 300];
const DAY = 24 * 60 * 60 * 1000;

type ExpRow = { id: string; hostId: string; title: string; description: string; city: string; priceCents: number; durationMinutes: number; createdAt: Date };
type SlotRow = { id: string; experienceId: string; startsAt: Date; capacity: number };

function buildRows(hostIds: string[], count: number, minSlots: number, maxSlots: number) {
  const experiences: ExpRow[] = [];
  const slots: SlotRow[] = [];
  for (let i = 0; i < count; i++) {
    const city = pick(cities);
    const activity = pick(activities);
    const durationMinutes = pick(durations);
    const id = randomUUID();
    experiences.push({
      id,
      hostId: pick(hostIds),
      title: `${pick(adjectives)} ${city} ${activity}`,
      description: `A ${durationMinutes / 60} hour ${activity.toLowerCase()} in ${city}, guided by a friendly local host.`,
      city,
      priceCents: int(30, 300) * 50,
      durationMinutes,
      createdAt: new Date(Date.now() - int(0, 180) * DAY),
    });
    const n = int(minSlots, maxSlots);
    for (let s = 0; s < n; s++) {
      const start = new Date(Date.now() + int(1, 90) * DAY);
      start.setUTCHours(int(8, 18), pick([0, 30]), 0, 0);
      slots.push({ id: randomUUID(), experienceId: id, startsAt: start, capacity: int(4, 20) });
    }
  }
  return { experiences, slots };
}

async function insertAll(rows: { experiences: ExpRow[]; slots: SlotRow[] }) {
  for (let i = 0; i < rows.experiences.length; i += 1000) {
    await prisma.experience.createMany({ data: rows.experiences.slice(i, i + 1000) });
  }
  for (let i = 0; i < rows.slots.length; i += 1000) {
    await prisma.slot.createMany({ data: rows.slots.slice(i, i + 1000) });
  }
}

async function ensureUser(email: string, name: string, role: "HOST" | "CUSTOMER", passwordHash: string) {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name, role, passwordHash },
  });
}

async function wipeHostData(hostIds: string[]) {
  await prisma.slot.deleteMany({ where: { experience: { hostId: { in: hostIds } } } });
  await prisma.experience.deleteMany({ where: { hostId: { in: hostIds } } });
}

async function main() {
  const mode = process.argv[2];
  const passwordHash = await bcrypt.hash("password123", 4);

  if (mode === "demo") {
    await ensureUser("demo@example.com", "Demo Customer", "CUSTOMER", passwordHash);
    const hosts: { id: string }[] = [];
    for (let i = 1; i <= 10; i++) {
      hosts.push(await ensureUser(`host${i}@example.com`, `Host ${i}`, "HOST", passwordHash));
    }
    const ids = hosts.map((h) => h.id);
    await wipeHostData(ids);
    await insertAll(buildRows(ids, 200, 3, 5));
    console.log("Seeded 10 hosts, 1 customer, 200 experiences with slots.");
  } else if (mode === "bulk") {
    const host = await ensureUser("bulk-host@example.com", "Bulk Host", "HOST", passwordHash);
    await wipeHostData([host.id]);
    await insertAll(buildRows([host.id], 20000, 2, 2));
    console.log("Seeded 20,000 bulk experiences with 40,000 slots.");
  } else if (mode === "clean") {
    const host = await prisma.user.findUnique({ where: { email: "bulk-host@example.com" } });
    if (host) {
      await wipeHostData([host.id]);
      await prisma.user.delete({ where: { id: host.id } });
    }
    console.log("Removed bulk data.");
  } else {
    console.error("Usage: tsx src/scripts/seed.ts demo | bulk | clean");
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());