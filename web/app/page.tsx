"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";

export default function Home() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api<{ status: string; db: string }>("/health"),
  });
  const me = useMe();

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-3xl font-bold">Wonderly</h1>

      <p className="mt-4">
        API:{" "}
        {health.isPending ? "checking..." : health.isError ? "down" : health.data.status}
      </p>

      <p>
        {me.isPending
          ? "Checking login..."
          : me.isError
            ? "Could not check login"
            : me.data
              ? `Logged in as ${me.data.name}`
              : "Not logged in"}
      </p>
    </main>
  );
}