import type { Context } from "hono";
import type { AdminBindings } from "./admin";
import type { AdminSession } from "./admin-auth";
import { can, type Permission, type Role } from "../shared/operations";
import { OpsError } from "./ops-store";
import type { View } from "./ops-view";
export type OpsBody = Record<string, string | File | (string | File)[]>;
export type OpsEnv = { Bindings: AdminBindings; Variables: { session: AdminSession; ipHash: string; role: Role; view: View; body: OpsBody; revision: number } };
export type OpsContext = Context<OpsEnv>;
export const db = (c: OpsContext) => c.env.OPS_DB!;
export const view = (c: OpsContext) => c.get("view");
export const actor = (c: OpsContext) => ({ id: c.get("session").user_id, role: c.get("role") });
export function requirePermission(c: OpsContext, permission: Permission) { if (!can(c.get("role"), permission)) throw new OpsError("FORBIDDEN", 403); }
export const value = (c: OpsContext, key: string) => typeof c.get("body")?.[key] === "string" ? c.get("body")[key] as string : "";
export function reason(c: OpsContext) { const result = value(c,"reason").trim(); if (result.length < 2 || result.length > 300) throw new OpsError("INVALID_INPUT"); return result; }
export function pageNumber(c: OpsContext) { const page = Number(c.req.query("page") || 1); if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new OpsError("INVALID_INPUT"); return page; }
