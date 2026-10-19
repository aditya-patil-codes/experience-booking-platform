import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config";
import { AppError } from "../errors";

export const requireAuth: RequestHandler = (req, _res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    throw new AppError(401, "Not logged In", "UNAUTHORIZED");
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (typeof payload === "string" || typeof payload.sub !== "string") {
      throw new Error("bad payload");
    }
    req.user = {
      id: payload.sub,
      role: payload["role"] as "HOST" | "CUSTOMER"
    };
    next();
  } catch {
    throw new AppError(401, "Invalid or expired session", "UNAUTHORIZED");
  }
};

export const requireRole = (...roles: Array<"HOST" | "CUSTOMER">): RequestHandler => (req,_res,next) =>{
    if(!req.user || !roles.includes(req.user.role)){
        throw new AppError(403, "You are not allowed to do this", "FORBIDDEN")
    }
    next() ; 
}
