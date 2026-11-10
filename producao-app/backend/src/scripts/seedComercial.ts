import { prisma } from "../config/prisma";
import { importarCarteira } from "../routes/comercial";
import seed from "../data/comercialSeed.json";
import leads from "../data/comercialLeads.json";

// ============================================================================
// Comercial em teste (2026-11-10): na cópia de testes (variável
// COMERCIAL_SEED=1) carrega uma vez a carteira, as visitas e a prospeção que
// vinham com o programa "carteira de clientes". Na Central real não corre.
// ============================================================================
export async function seedComercial(): Promise<void> {
  if (process.env.COMERCIAL_SEED !== "1") return;
  try {
    const n = await prisma.comercialCliente.count();
    if (n > 0) return;
    const r = await importarCarteira({
      clients: (seed as unknown as { clients: never[] }).clients,
      visits: (seed as unknown as { visits: never[] }).visits,
      leads: leads as unknown as never[],
    });
    // eslint-disable-next-line no-console
    console.log(`[comercial] carteira carregada: ${r.clientes} clientes, ${r.visitas} visitas, ${r.leads} empresas em prospeção`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[comercial] falhou a carregar a carteira", err);
  }
}
