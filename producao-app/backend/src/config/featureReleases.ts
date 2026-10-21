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
  cutPlans: "Otimização de Corte",
  orcamentos: "Orçamentos",
  compras: "Compras",
  inicio: "Ecrã Inicial (Central Minho Ferragens)",
  horas: "Controlo de Horas",
  kmViaturas: "Km das Carrinhas",
  etiquetaPainel: "Nova etiqueta dos painéis",
  menuHover: "Menu lateral que abre ao passar o rato",
} as const;

export type FeatureKey = keyof typeof FEATURES;

// Funcionalidades de acesso restrito (pedido do utilizador de 2026-10-20:
// os Orçamentos são "apenas para João Costa e David Costa"). Nunca são
// lançadas para todos: só os administradores e os utilizadores escolhidos
// pelo administrador (testerUserIds) as veem, mesmo depois de aprovadas.
export const RESTRICTED_FEATURES: ReadonlySet<string> = new Set(["orcamentos"]);

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
  if (RESTRICTED_FEATURES.has(key)) return !!row?.testerUserIds.includes(user.id);
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
