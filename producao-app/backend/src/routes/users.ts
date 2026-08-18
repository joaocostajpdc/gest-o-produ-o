import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { UserRole } from "@prisma/client";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { PERMISSION_MATRIX } from "../config/permissions";
import { asyncHandler } from "../utils/asyncHandler";

export const usersRouter = Router();
usersRouter.use(requireAuth);

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.nativeEnum(UserRole),
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.nativeEnum(UserRole).optional(),
  active: z.boolean().optional(),
  password: z.string().min(6).optional(),
});

usersRouter.get(
  "/",
  requirePermission("users:read"),
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    });
    res.json(users);
  })
);

// Matriz de permissões (Tabela de Permissões para cada Perfil de Utilizador),
// exposta para que a interface possa apresentar/consultar os acessos por perfil.
usersRouter.get(
  "/permissions-matrix",
  requirePermission("users:read"),
  asyncHandler(async (_req, res) => {
    res.json(PERMISSION_MATRIX);
  })
);

usersRouter.post(
  "/",
  requirePermission("users:write"),
  asyncHandler(async (req, res) => {
    const data = createUserSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await prisma.user.create({
      data: { name: data.name, email: data.email, role: data.role, passwordHash },
      select: { id: true, name: true, email: true, role: true, active: true },
    });
    res.status(201).json(user);
  })
);

usersRouter.put(
  "/:id",
  requirePermission("users:write"),
  asyncHandler(async (req, res) => {
    const data = updateUserSchema.parse(req.body);
    const passwordHash = data.password ? await bcrypt.hash(data.password, 10) : undefined;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        name: data.name,
        role: data.role,
        active: data.active,
        ...(passwordHash ? { passwordHash } : {}),
      },
      select: { id: true, name: true, email: true, role: true, active: true },
    });
    res.json(user);
  })
);
