import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "./api";
import type { User } from "./types";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        const res = await api<{ user: User }>("/auth/me");
        return res.user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    retry: false,
  });
}