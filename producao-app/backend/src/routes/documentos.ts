import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { requireFeature } from "../config/featureReleases";
import { asyncHandler } from "../utils/asyncHandler";

// ============================================================================
// Documentos (catálogos, tabelas de preço) por departamento — pedido do
// utilizador de 2026-11-17. Qualquer utilizador pode ver, fazer download e
// carregar novos ficheiros. 4 departamentos: Comercial, Produção,
// Compras/Fornecedores, Administrativo/Financeiro.
// ============================================================================

export const documentosRouter = Router();
documentosRouter.use(requireAuth);
documentosRouter.use(requireFeature("documentos"));

const DEPARTAMENTOS = ["comercial", "producao", "compras", "administrativo"] as const;
type Departamento = (typeof DEPARTAMENTOS)[number];

const MIME_PERMITIDOS = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
];

// GET /api/documentos?dept=comercial — lista metadados (sem conteúdo)
documentosRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const dept = req.query.dept as string | undefined;
    const where = dept && DEPARTAMENTOS.includes(dept as Departamento)
      ? `WHERE departamento = $1`
      : "";
    const params = dept && DEPARTAMENTOS.includes(dept as Departamento) ? [dept] : [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await (prisma.$queryRawUnsafe as any)(
      `SELECT id, departamento, nome, mime_type, tamanho, uploaded_by, uploaded_at
       FROM documentos
       ${where}
       ORDER BY uploaded_at DESC`,
      ...params
    );

    // Resolver nomes dos utilizadores
    const userIds = [...new Set(rows.map((r: any) => r.uploaded_by as string))];
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const userMap = Object.fromEntries(users.map((u: { id: string; name: string }) => [u.id, u.name]));

    res.json(
      rows.map((r: any) => ({
        id: r.id,
        departamento: r.departamento,
        nome: r.nome,
        mimeType: r.mime_type,
        tamanho: Number(r.tamanho),
        uploadedBy: userMap[r.uploaded_by] ?? r.uploaded_by,
        uploadedAt: r.uploaded_at,
      }))
    );
  })
);

// POST /api/documentos — carrega novo ficheiro (base64 no body)
const uploadSchema = z.object({
  departamento: z.enum(DEPARTAMENTOS),
  nome: z.string().min(1).max(200),
  mimeType: z.string().refine((m) => MIME_PERMITIDOS.includes(m), "Tipo de ficheiro não permitido."),
  base64: z.string().min(1),
});

documentosRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { departamento, nome, mimeType, base64 } = uploadSchema.parse(req.body);

    const buf = Buffer.from(base64, "base64");
    const tamanho = buf.length;

    // 20 MB máximo
    if (tamanho > 20 * 1024 * 1024) {
      return res.status(400).json({ error: "Ficheiro demasiado grande (máx. 20 MB)." });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [row]: any[] = await (prisma.$queryRawUnsafe as any)(
      `INSERT INTO documentos (departamento, nome, mime_type, tamanho, conteudo, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, uploaded_at`,
      departamento,
      nome,
      mimeType,
      tamanho,
      buf,
      req.user!.id
    );

    res.status(201).json({
      id: row.id,
      departamento,
      nome,
      mimeType,
      tamanho,
      uploadedBy: req.user!.name,
      uploadedAt: row.uploaded_at,
    });
  })
);

// GET /api/documentos/:id/download — devolve o ficheiro
documentosRouter.get(
  "/:id/download",
  asyncHandler(async (req, res) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [row]: any[] = await (prisma.$queryRawUnsafe as any)(
      `SELECT nome, mime_type, conteudo FROM documentos WHERE id = $1`,
      req.params.id
    );

    if (!row) return res.status(404).json({ error: "Documento não encontrado." });

    res.setHeader("Content-Type", row.mime_type);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(row.nome)}"`);
    res.send(row.conteudo);
  })
);

// DELETE /api/documentos/:id — só administradores
documentosRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    if (req.user?.role !== "ADMINISTRADOR") {
      return res.status(403).json({ error: "Só o administrador pode apagar documentos." });
    }
    const result = await prisma.$executeRawUnsafe(
      `DELETE FROM documentos WHERE id = $1`,
      req.params.id
    );
    if (result === 0) return res.status(404).json({ error: "Documento não encontrado." });
    res.json({ ok: true });
  })
);
