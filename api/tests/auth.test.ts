import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { resetDb } from "./helpers";

const user = {
  name: "Priya",
  email: "priya@example.com",
  password: "password123",
  role: "HOST"
};

describe("auth", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("registers a user without exposing the password hash", async () => {
    const res = await request(app).post("/auth/register").send(user);
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("priya@example.com");
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("rejects a duplicate email with 409", async () => {
    await request(app).post("/auth/register").send(user).expect(201);
    const res = await request(app).post("/auth/register").send(user);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("rejects a short password with a validation error", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ ...user, password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("does not allow registering with an unknown role", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ ...user, role: "ADMIN" });
    expect(res.status).toBe(400);
  });

  it("logs in and sets an httpOnly cookie", async () => {
    await request(app).post("/auth/register").send(user).expect(201);
    const res = await request(app)
      .post("/auth/login")
      .send({ email: user.email, password: user.password });
    expect(res.status).toBe(200);
    const cookie = ([] as string[])
      .concat(res.headers["set-cookie"] ?? [])
      .join(";");
    expect(cookie).toContain("token=");
    expect(cookie).toContain("HttpOnly");
  });

  it("rejects a wrong password with 401", async () => {
    await request(app).post("/auth/register").send(user).expect(201);
    const res = await request(app)
      .post("/auth/login")
      .send({ email: user.email, password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("gives the same error for an unknown email", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "nobody@example.com", password: "password123" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("blocks /auth/me without a cookie", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns the profile on /auth/me when logged in", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/register").send(user).expect(201);
    await agent
      .post("/auth/login")
      .send({ email: user.email, password: user.password })
      .expect(200);
    const res = await agent.get("/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(user.email);
  });

  it("logs out and loses access", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/register").send(user).expect(201);
    await agent
      .post("/auth/login")
      .send({ email: user.email, password: user.password })
      .expect(200);
    await agent.post("/auth/logout").expect(204);
    await agent.get("/auth/me").expect(401);
  });
});
