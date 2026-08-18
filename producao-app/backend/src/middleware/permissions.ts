import { NextFunction, Request, Response } from "express";
import { Permission, hasPermission } from "../config/permissions";

// Middleware de autorização: garante que o utilizador autenticado tem a
// permissão necessária, de acordo com a matriz de permissões do seu perfil.
// A implementação deverá garantir que operações não autorizadas não se
// encontram disponíveis para o respetivo perfil de utilizador.
export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Autenticação necessária." });
    }
    if (!hasPermission(req.user.role, permission)) {
      return res.status(403).json({
        error: `O perfil "${req.user.role}" não tem permissão para "${permission}".`,
      });
    }
    next();
  };
}
