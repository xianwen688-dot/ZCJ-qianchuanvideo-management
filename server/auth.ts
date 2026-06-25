import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db, getSetting } from "./db";

export type Role = "admin" | "operator" | "viewer";

export interface AuthUser {
  id: number;
  username: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function login(username: string, password: string) {
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
    | {
        id: number;
        username: string;
        password_hash: string;
        role: Role;
      }
    | undefined;
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return null;

  const payload: AuthUser = {
    id: user.id,
    username: user.username,
    role: user.role
  };
  const token = jwt.sign(payload, getSetting("jwtSecret"), { expiresIn: "7d" });
  return { token, user: payload };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "未登录" });
    return;
  }
  try {
    req.user = jwt.verify(token, getSetting("jwtSecret")) as AuthUser;
    next();
  } catch {
    res.status(401).json({ error: "登录已过期，请重新登录" });
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    next();
    return;
  }
  try {
    req.user = jwt.verify(token, getSetting("jwtSecret")) as AuthUser;
  } catch {
    req.user = undefined;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  // First authenticate, then check role
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "未登录" });
    return;
  }
  try {
    req.user = jwt.verify(token, getSetting("jwtSecret")) as AuthUser;
  } catch {
    res.status(401).json({ error: "登录已过期，请重新登录" });
    return;
  }
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "需要管理员权限" });
    return;
  }
  next();
}
