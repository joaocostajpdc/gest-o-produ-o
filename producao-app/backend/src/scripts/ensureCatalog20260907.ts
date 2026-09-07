import { prisma } from "../config/prisma";

// ============================================================================
// Lançamento pontual de 2 artigos — pedido do utilizador de 2026-09-07:
// "lança estes artigos categoria outros etapas: fresagem, pré-lacagem,
// lacagem, embalamento" (com foto do "Gerir Artigos" do Goldylocks
// mostrando DCSPL "Sapata lisa" e DCTPL "Topos lisos"; "preçacagem" foi
// esclarecido como "Pré-Lacagem" e o prazo como "10 a 12 dias").
//
// Corre uma vez no arranque da aplicação (chamado a partir de src/index.ts,
// antes de app.listen) em vez de precisar de acesso direto à base de dados
// ou ao ecrã do utilizador — a única via disponível neste momento para
// criar dados sem ser manualmente pela interface, seguindo o mesmo fluxo
// já usado para alterações de código (colar ficheiro no GitHub, o Render
// faz o deploy e a aplicação arranca).
//
// Escrito para ser seguro correr mais do que uma vez (todas as escritas são
// "cria só se não existir") — por isso fica a correr permanentemente no
// arranque em vez de precisar de ser removido depois; se os artigos/etapas
// já existirem (nesta ou em execuções futuras), não faz nada.
//
// As etapas usam os nomes exatos já existentes na aplicação (confirmados
// pelo utilizador com um print da página Tabelas > Etapas em 2026-09-07):
// "Fresagem", "Pré-Lacagem", "Lacagem" e "Embalagem" — não "Embalamento",
// que era como o utilizador tinha escrito o pedido.
// ============================================================================

async function ensureStageId(name: string): Promise<string> {
  const existing = await prisma.stage.findUnique({ where: { name } });
  if (existing) return existing.id;
  const created = await prisma.stage.create({ data: { name } });
  console.log(`[ensureCatalog20260907] Etapa "${name}" não existia — criada.`);
  return created.id;
}

async function ensureProductId(
  externalId: string,
  name: string,
  category: string,
  productionDays: number
): Promise<{ id: string; wasCreated: boolean }> {
  const existing = await prisma.product.findUnique({ where: { externalId } });
  if (existing) return { id: existing.id, wasCreated: false };
  const created = await prisma.product.create({ data: { externalId, name, category, productionDays } });
  console.log(`[ensureCatalog20260907] Artigo "${externalId} — ${name}" não existia — criado.`);
  return { id: created.id, wasCreated: true };
}

async function ensureLineStep(productId: string, stageId: string, order: number): Promise<void> {
  const existing = await prisma.productionLineStep.findFirst({ where: { productId, stageId } });
  if (existing) return;
  await prisma.productionLineStep.create({ data: { productId, stageId, order } });
}

export async function ensureCatalog20260907(): Promise<void> {
  try {
    const fresagemId = await ensureStageId("Fresagem");
    const preLacagemId = await ensureStageId("Pré-Lacagem");
    const lacagemId = await ensureStageId("Lacagem");
    const embalagemId = await ensureStageId("Embalagem");

    const sapata = await ensureProductId("DCSPL", "Sapata lisa", "Outros", 10);
    const topos = await ensureProductId("DCTPL", "Topos lisos", "Outros", 12);

    for (const product of [sapata, topos]) {
      await ensureLineStep(product.id, fresagemId, 10);
      await ensureLineStep(product.id, preLacagemId, 20);
      await ensureLineStep(product.id, lacagemId, 30);
      await ensureLineStep(product.id, embalagemId, 40);
    }

    if (sapata.wasCreated || topos.wasCreated) {
      console.log("[ensureCatalog20260907] Artigos DCSPL/DCTPL e respetiva linha de produção prontos.");
    }
  } catch (err) {
    // Nunca deve impedir o arranque da aplicação por causa disto.
    console.error("[ensureCatalog20260907] Falhou (a aplicação continua a arrancar normalmente):", err);
  }
}
