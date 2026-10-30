import express, { Router } from "express";
import { z } from "zod";
import pdfParse from "pdf-parse";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { requireFeature } from "../config/featureReleases";
import { asyncHandler } from "../utils/asyncHandler";
import { analyzeGuiaText, applyGuia } from "../services/lacagemGuiaService";

// ============================================================================
// Submeter guia da Lacagem (pedido do utilizador de 2026-10-30). Em teste:
// "guiaLacagem". O browser lê as fotografias por OCR; os PDFs são lidos aqui.
// ============================================================================

export const lacagemGuiasRouter = Router();
lacagemGuiasRouter.use(requireAuth, requireFeature("guiaLacagem"));

lacagemGuiasRouter.post(
  "/ler-pdf",
  requirePermission("serviceOrders:changeStatus"),
  express.raw({ type: "application/pdf", limit: "20mb" }),
  asyncHandler(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "Nenhum PDF recebido." });
    }
    const data = await pdfParse(req.body);
    res.json({ text: data.text ?? "" });
  })
);

const analyzeSchema = z.object({ text: z.string().max(200_000) });
lacagemGuiasRouter.post(
  "/analisar",
  requirePermission("serviceOrders:changeStatus"),
  express.json({ limit: "1mb" }),
  asyncHandler(async (req, res) => {
    const { text } = analyzeSchema.parse(req.body);
    res.json(await analyzeGuiaText(text));
  })
);

const applySchema = z.object({
  direction: z.enum(["enviar", "retirar"]),
  orderIds: z.array(z.string().min(1)).min(1).max(60),
  supplierId: z.string().min(1).nullable().optional(),
  guiaNumber: z.string().max(40).nullable().optional(),
  notes: z.record(z.string(), z.string().max(300)).optional(),
  files: z
    .array(
      z.object({
        filename: z.string().min(1).max(200),
        mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"]),
        base64: z.string().min(1),
      })
    )
    .max(6),
});
lacagemGuiasRouter.post(
  "/aplicar",
  requirePermission("serviceOrders:changeStatus"),
  express.json({ limit: "40mb" }),
  asyncHandler(async (req, res) => {
    const body = applySchema.parse(req.body);
    const results = await applyGuia({
      direction: body.direction,
      orderIds: body.orderIds,
      supplierId: body.supplierId ?? null,
      guiaNumber: body.guiaNumber ?? null,
      notes: body.notes,
      files: body.files.map((f) => ({
        filename: f.filename,
        mimeType: f.mimeType,
        data: Buffer.from(f.base64, "base64"),
      })),
      userId: req.user?.id,
    });
    res.json({ results });
  })
);
