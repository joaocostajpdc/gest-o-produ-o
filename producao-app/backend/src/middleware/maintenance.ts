import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

// ============================================================================
// Período de manutenção — pedido do utilizador de 2026-10-20: "bloquear o
// programa das 23:00 às 07:00 para eu poder fazer as alterações, para todos
// menos para o admin".
//
// Durante esse período (hora de Portugal continental) só os utilizadores
// ADMINISTRADOR conseguem entrar e usar a API; os restantes recebem 503 com
// a mensagem abaixo e o ecrã volta ao login com o aviso.
// Pode ser ajustado sem mexer no código com as variáveis de ambiente
// MAINTENANCE_START_HOUR / MAINTENANCE_END_HOUR (0-23) ou desligado com
// MAINTENANCE_DISABLED=1.
// ============================================================================

const START = Number(process.env.MAINTENANCE_START_HOUR ?? 23);
const END = Number(process.env.MAINTENANCE_END_HOUR ?? 7);
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";

function pad(h: number) {
  return String(h).padStart(2, "0") + ":00";
}

export const MAINTENANCE_MESSAGE = `O programa está em manutenção das ${pad(START)} às ${pad(END)}. Volte a entrar a partir das ${pad(END)}.`;

export function inMaintenanceWindow(now = new Date()): boolean {
  if (process.env.MAINTENANCE_DISABLED === "1") return false;
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Europe/Lisbon" }).format(now)
  );
  return START > END ? hour >= START || hour < END : hour >= START && hour < END;
}

/** Bloqueia a API a quem não é administrador durante o período de manutenção. */
export function maintenanceGuard(req: Request, res: Response, next: NextFunction) {
  if (!inMaintenanceWindow()) return next();
  // O login trata do caso à parte (precisa de saber quem está a entrar).
  if (req.path === "/auth/login" || req.path === "/health") return next();
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      const user = jwt.verify(header.slice("Bearer ".length), JWT_SECRET) as { role?: string };
      if (user.role === "ADMINISTRADOR") return next();
    } catch {
      // token inválido: segue para o requireAuth da rota, que responde 401
      return next();
    }
  } else {
    return next();
  }
  return res.status(503).json({ error: MAINTENANCE_MESSAGE, maintenance: true });
}
