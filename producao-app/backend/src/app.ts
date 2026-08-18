import express, { NextFunction, Request, Response } from "express";
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

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api/auth", authRouter);
  app.use("/api/products", productsRouter);
  app.use("/api/stages", stagesRouter);
  app.use("/api/production-lines", productionLinesRouter);
  app.use("/api/suppliers", suppliersRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/clients", clientsRouter);
  app.use("/api/service-orders", serviceOrdersRouter);
  app.use("/api/reports", reportsRouter);

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
