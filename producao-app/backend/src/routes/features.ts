import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { FEATURES, FeatureKey, isFeatureKey, RESTRICTED_FEATURES } from "../config/featureReleases";

// ============================================================================
// Estado do lançamento das funcionalidades novas (ver
// config/featureReleases.ts). Qualquer utilizador autenticado pode consultar
// o estado (para o menu saber o que mostrar); só o ADMINISTRADOR aprova,
// recolhe ou escolhe quem testa uma funcionalidade.
// ============================================================================

export const featuresRouter = Router();
featuresRouter.use(requireAuth);

type Row = Awaited<ReturnType<typeof prisma.featureRelease.findMany>>[number];

function present(key: FeatureKey, row: Row | undefined, user: { id: string; role: string }) {
  const isAdmin = user.role === "ADMINISTRADOR";
  const restricted = RESTRICTED_FEATURES.has(key);
  const released = !restricted && !!row?.released;
  const testers = row?.testerUserIds ?? [];
  return {
    key,
    name: FEATURES[key],
    restricted,
    released,
    available: released || isAdmin || testers.includes(user.id),
    releasedAt: row?.releasedAt ?? null,
    // A lista de quem testa só é mostrada ao administrador.
    ...(isAdmin ? { testerUserIds: testers } : {}),
  };
}

featuresRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const rows = await prisma.featureRelease.findMany();
    res.json((Object.keys(FEATURES) as FeatureKey[]).map((key) => present(key, rows.find((r) => r.key === key), req.user!)));
  })
);

const updateSchema = z
  .object({
    released: z.boolean().optional(),
    testerUserIds: z.array(z.string()).max(100).optional(),
  })
  .refine((d) => d.released !== undefined || d.testerUserIds !== undefined, "Nada para alterar.");

featuresRouter.put(
  "/:key",
  asyncHandler(async (req, res) => {
    if (req.user?.role !== "ADMINISTRADOR") {
      return res.status(403).json({ error: "Só o administrador pode aprovar funcionalidades novas." });
    }
    const key = req.params.key;
    if (!isFeatureKey(key)) {
      throw new Error("Funcionalidade não encontrada.");
    }
    const { released, testerUserIds } = updateSchema.parse(req.body);
    if (released && RESTRICTED_FEATURES.has(key)) {
      return res.status(400).json({ error: "Esta funcionalidade é de acesso restrito e não pode ser lançada para todos." });
    }
    const data = {
      ...(released !== undefined
        ? { released, releasedAt: released ? new Date() : null, releasedById: released ? req.user.id : null }
        : {}),
      ...(testerUserIds !== undefined ? { testerUserIds: [...new Set(testerUserIds)] } : {}),
    };
    const row = await prisma.featureRelease.upsert({
      where: { key },
      create: { key, ...data },
      update: data,
    });
    res.json(present(key, row, req.user));
  })
);
