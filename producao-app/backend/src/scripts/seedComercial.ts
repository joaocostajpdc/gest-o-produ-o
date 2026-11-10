import { prisma } from "../config/prisma";
import { importarCarteira } from "../routes/comercial";
import seed from "../data/comercialSeed.json";
import leads from "../data/comercialLeads.json";

// ============================================================================
// Comercial em teste (2026-11-10): na cópia de testes (variável
// COMERCIAL_SEED=1) carrega a carteira, as visitas e a prospeção que vinham
// com o programa "carteira de clientes". Na Central real não corre.
// Volta a correr se alguma parte ficou incompleta; não duplica nada (cada
// registo tem o id antigo, origemId). A prospeção vai numa só gravação.
// ============================================================================
interface SeedLead { id: string; mercado?: string; nif?: string; name: string; distrito?: string; email?: string; phone?: string; estado?: string; newsletter?: boolean; whatsapp?: boolean; emailApresentacao?: string; campanhas?: string; conversas?: string; notes?: string }
const blank = (s: string | undefined | null) => (s && String(s).trim() ? String(s).trim() : null);
const ESTADOS = ["prospecao", "conversas", "cliente", "concorrente", "sem_interesse"];

export async function seedComercial(): Promise<void> {
  if (process.env.COMERCIAL_SEED !== "1") return;
  try {
    const all = leads as unknown as SeedLead[];
    const clients = (seed as unknown as { clients: never[] }).clients;
    const [nc, nl] = await Promise.all([prisma.comercialCliente.count(), prisma.comercialLead.count()]);
    if (nc < clients.length) {
      const r = await importarCarteira({ clients, visits: (seed as unknown as { visits: never[] }).visits });
      // eslint-disable-next-line no-console
      console.log(`[comercial] carteira: ${r.clientes} clientes, ${r.visitas} visitas`);
    }
    if (nl < all.length) {
      const r = await prisma.comercialLead.createMany({
        skipDuplicates: true,
        data: all.map((l) => ({
          origemId: l.id,
          mercado: l.mercado === "ES" ? "ES" : "PT",
          nif: blank(l.nif),
          nome: l.name,
          distrito: blank(l.distrito),
          email: blank(l.email),
          telefone: blank(l.phone),
          estado: ESTADOS.includes(l.estado ?? "") ? l.estado! : "prospecao",
          newsletter: !!l.newsletter,
          whatsapp: !!l.whatsapp,
          emailApresentacao: blank(l.emailApresentacao),
          campanhas: blank(l.campanhas),
          conversas: blank(l.conversas),
          notas: blank(l.notes),
        })),
      });
      // eslint-disable-next-line no-console
      console.log(`[comercial] prospeção: +${r.count} empresas`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[comercial] falhou a carregar a carteira", err);
  }
}
