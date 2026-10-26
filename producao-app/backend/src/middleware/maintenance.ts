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

// ============================================================================
// Bloqueio por atualização — pedido do utilizador de 2026-10-26: "põe o
// programa bloqueado com aviso de atualização; só tiras quando eu disser;
// aviso também para o admin".
//
// Ligado com a variável de ambiente UPDATE_LOCK=1 (no Render). Enquanto
// estiver ligado, TODOS — incluindo o administrador — veem o ecrã de aviso e
// a API responde 503. Para desbloquear, apagar a variável (ou pôr 0).
// ============================================================================

export const UPDATE_LOCK_MESSAGE =
  "O programa está em atualização de segurança. Volta a entrar mais tarde — avisamos quando estiver disponível.";

export function updateLockActive(): boolean {
  return process.env.UPDATE_LOCK === "1";
}

const UPDATE_LOCK_PAGE = `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Central Minho Ferragens — Em atualização</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         background: #f4f5f7; color: #1d2330; padding: 16px; box-sizing: border-box; }
  .card { max-width: 440px; width: 100%; background: #fff; border-radius: 14px;
          padding: 32px 28px; box-shadow: 0 6px 24px rgba(0,0,0,.08); text-align: center; }
  .icon { font-size: 40px; line-height: 1; margin-bottom: 12px; }
  h1 { font-size: 20px; margin: 0 0 10px; }
  p { margin: 0; color: #4a5263; line-height: 1.5; }
  @media (prefers-color-scheme: dark) {
    body { background: #14171d; color: #e8eaf0; }
    .card { background: #1d2129; box-shadow: none; }
    p { color: #aab1c0; }
  }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">🔧</div>
    <h1>Programa em atualização</h1>
    <p>${UPDATE_LOCK_MESSAGE}</p>
  </div>
</body>
</html>`;

/**
 * Bloqueio total durante uma atualização: vale para todos, administrador
 * incluído. A API responde 503 e qualquer página mostra o aviso.
 */
export function updateLockGuard(req: Request, res: Response, next: NextFunction) {
  if (!updateLockActive()) return next();
  if (req.path === "/api/health") return next();
  res.set("Cache-Control", "no-store");
  if (req.path.startsWith("/api")) {
    return res.status(503).json({ error: UPDATE_LOCK_MESSAGE, maintenance: true, update: true });
  }
  return res.status(503).type("html").send(UPDATE_LOCK_PAGE);
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
