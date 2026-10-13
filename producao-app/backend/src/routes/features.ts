import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { FEATURES, FeatureKey, isFeatureKey } from "../config/featureReleases";

// ============================================================================
// Estado do lançamento das funcionalidades novas (ver
// config/featureReleases.ts). Qualquer utilizador autenticado pode consultar
// o estado (para o menu saber o que mostrar); só o ADMINISTRADOR aprova ou
// recolhe uma funcionalidade.
// ============================================================================

export const featuresRouter = Router();
featuresRouter.use(requireAuth);

featuresRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const rows = await prisma.featureRelease.findMany();
    const isAdmin = req.user?.role === "ADMINISTRADOR";
    const result = (Object.keys(FEATURES) as FeatureKey[]).map((key) => {
      const row = rows.find((r) => r.key === key);
      const released = !!row?.released;
      return {
        key,
        name: FEATURES[key],
        released,
        available: released || isAdmin,
        releasedAt: row?.releasedAt ?? null,
      };
    });
    res.json(result);
  })
);

const updateSchema = z.object({ released: z.boolean() });

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
    const { released } = updateSchema.parse(req.body);
    const data = {
      released,
      releasedAt: released ? new Date() : null,
      releasedById: released ? req.user.id : null,
    };
    const row = await prisma.featureRelease.upsert({
      where: { key },
      create: { key, ...data },
      update: data,
    });
    res.json({ key, name: FEATURES[key], released: row.released, available: true, releasedAt: row.releasedAt });
  })
);
