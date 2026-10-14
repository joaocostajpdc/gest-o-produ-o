import { NextFunction, Request, Response } from "express";
import { prisma } from "./prisma";

// ============================================================================
// Lançamento faseado de funcionalidades novas — pedido do utilizador de
// 2026-10-13: "quero primeiro lançar as atualizações apenas para o
// administrador e só depois de ele aprovar lançar para o resto".
//
// Cada funcionalidade nova fica registada em FEATURES com uma chave. Enquanto
// não for aprovada (linha em feature_releases com released = true), só os
// utilizadores ADMINISTRADOR a veem no menu e conseguem usar a sua API; os
// restantes perfis recebem 404, como se ela ainda não existisse. O
// administrador aprova-a dentro da aplicação (página da própria
// funcionalidade), o que a liberta para todos de imediato, sem novo deploy.
//
// Para uma funcionalidade futura: acrescentar a chave a FEATURES, proteger as
// rotas com requireFeature("chave") e, no frontend, usar useFeature("chave").
// ============================================================================

export const FEATURES = {
  powderStock: "Pó em Stock",
  glassOrders: "Pedidos de Vidros",
  osSidePanel: "Painel lateral das OS",
} as const;

export type FeatureKey = keyof typeof FEATURES;

export function isFeatureKey(value: string): value is FeatureKey {
  return Object.prototype.hasOwnProperty.call(FEATURES, value);
}

/**
 * A funcionalidade está disponível para este utilizador? Sim se for
 * administrador, se já tiver sido aprovada para todos, ou se este
 * utilizador tiver sido escolhido para a testar (testerUserIds).
 */
export async function canUseFeature(
  key: FeatureKey,
  user?: { id: string; role: string } | null
): Promise<boolean> {
  if (!user) return false;
  if (user.role === "ADMINISTRADOR") return true;
  const row = await prisma.featureRelease.findUnique({ where: { key } });
  return !!row?.released || !!row?.testerUserIds.includes(user.id);
}

/**
 * Middleware: bloqueia a rota a quem não é administrador enquanto a
 * funcionalidade não tiver sido aprovada. Usar depois de requireAuth.
 */
export function requireFeature(key: FeatureKey) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (await canUseFeature(key, req.user)) return next();
      return res.status(404).json({ error: "Funcionalidade ainda não disponível." });
    } catch (err) {
      next(err);
    }
  };
}
