import { PrismaClient } from "@prisma/client";

// Cliente Prisma singleton (evita esgotar ligações em dev com hot-reload).
declare global {
  // eslint-disable-next-line no-var
  var __prisma__: PrismaClient | undefined;
}

export const prisma = global.__prisma__ ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma__ = prisma;
}
