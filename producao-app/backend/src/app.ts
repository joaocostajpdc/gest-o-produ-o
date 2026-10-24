import express, { NextFunction, Request, Response } from "express";
import { maintenanceGuard } from "./middleware/maintenance";
import cors from "cors";
import { ZodError } from "zod";
import path from "path";
import fs from "fs";
import { authRouter } from "./routes/auth";
import { productsRouter } from "./routes/products";
import { stagesRouter, productionLinesRouter } from "./routes/stages";
import { suppliersRouter } from "./routes/suppliers";
import { usersRouter } from "./routes/users";
import { clientsRouter } from "./routes/clients";
import { serviceOrdersRouter } from "./routes/serviceOrders";
import { reportsRouter } from "./routes/reports";
import { materialRequestsRouter } from "./routes/materialRequests";
import { powdersRouter } from "./routes/powders";
import { featuresRouter } from "./routes/features";
import { glassOrdersRouter } from "./routes/glassOrders";
import { cutPlansRouter } from "./routes/cutPlans";
import { telegramRouter } from "./routes/telegram";
import { orcamentosRouter } from "./routes/orcamentos";
import { emailReportsRouter } from "./routes/emailReports";
import { prisma } from "./config/prisma";
import { colaboradoresRouter, horasRouter, viaturasRouter } from "./routes/equipaFrota";
import { chatRouter } from "./routes/chat";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

  // Das 23:00 às 07:00 só o administrador usa o programa (ver middleware/maintenance.ts).
  app.use("/api", maintenanceGuard);

  // Público (antes do login): diz se o novo visual "Central Minho Ferragens"
  // já foi aprovado para todos, para o ecrã de entrada saber qual mostrar.
  app.get("/api/public/ui", async (_req, res) => {
    try {
      const row = await prisma.featureRelease.findUnique({ where: { key: "inicio" } });
      res.json({ central: !!row?.released });
    } catch {
      res.json({ central: false });
    }
  });

  app.use("/api/auth", authRouter);
  app.use("/api/products", productsRouter);
  app.use("/api/stages", stagesRouter);
  app.use("/api/production-lines", productionLinesRouter);
  app.use("/api/suppliers", suppliersRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/clients", clientsRouter);
  app.use("/api/service-orders", serviceOrdersRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/material-requests", materialRequestsRouter);
  app.use("/api/powders", powdersRouter);
  app.use("/api/features", featuresRouter);
  app.use("/api/glass-orders", glassOrdersRouter);
  app.use("/api/cut-plans", cutPlansRouter);
  app.use("/api/telegram", telegramRouter);
  app.use("/api/orcamentos", orcamentosRouter);
  app.use("/api/email-reports", emailReportsRouter);
  app.use("/api/colaboradores", colaboradoresRouter);
  app.use("/api/horas", horasRouter);
  app.use("/api/viaturas", viaturasRouter);
  app.use("/api/chat", chatRouter);

  // Serve o build do frontend (Vite) a partir deste mesmo serviço, quando
  // existir — permite publicar backend + frontend como um único deploy
  // (ex.: Render Free) sem precisar de dois serviços/URLs separados.
  const frontendDist = path.join(__dirname, "../../frontend/dist");
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(frontendDist, "index.html"));
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "Dados inválidos.", details: err.flatten() });
    }
    if (err instanceof Error) {
      // eslint-disable-next-line no-console
      console.error(err);
      const status = /não encontrad|not found/i.test(err.message) ? 404 : 400;
      return res.status(status).json({ error: err.message });
    }
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(500).json({ error: "Erro interno do servidor." });
  });

  return app;
}
