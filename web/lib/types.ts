export type Role = "HOST" | "CUSTOMER";

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

export type Experience = {
  id: string;
  hostId: string;
  title: string;
  description: string;
  city: string;
  priceCents: number;
  currency: string;
  durationMinutes: number;
  createdAt: string; // dates arrive as text in JSON
};

export type Slot = {
  id: string;
  experienceId: string;
  startsAt: string;
  capacity: number;
};