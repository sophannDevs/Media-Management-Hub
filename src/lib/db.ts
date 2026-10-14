import { PrismaClient } from "@prisma/client";

// Reuse one client across hot reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// PRISMA_LOG_QUERIES=1 prints every query (used by scripts/measure-queries.mjs)
const logQueries = process.env.PRISMA_LOG_QUERIES === "1";

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: logQueries ? [{ emit: "stdout", level: "query" }, "warn", "error"] : process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
