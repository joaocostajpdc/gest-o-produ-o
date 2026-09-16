import { prisma } from "../config/prisma";

// ============================================================================
// Correção pontual da OS 2026/433 — pedido do utilizador de 2026-09-16:
// "nas etiquetas continua sem por a v/ ref ou v/ enc".
//
// A OS 2026/433 foi importada do Goldylocks antes da correção do extrator
// (ver goldylocksPdfParser.ts, extractVRefArtigo, corrigida em 2026-09-08),
// por isso o texto de "Características do Produto" já gravado para esta OS
// ficou sem essa linha — o extrator só passou a reconhecer o formato
// "V/Enc. Nº ..." depois de a OS já ter sido importada com o formato antigo
// (que só apanhava "V/Ref.:"). Reimportar a mesma OS não é possível (o
// sistema bloqueia como "já importada anteriormente" — ver
// importSingleGoldylocksOrder em serviceOrderService.ts) e não há campo de
// edição desse texto na aplicação (a página da OS só o mostra em
// "Características do Produto", nunca o edita) — por isso, tal como já
// aconteceu com ensureCatalog20260907.ts, a única via disponível para
// corrigir dados já gravados sem acesso direto à base de dados é um script
// que corre uma vez no arranque da aplicação.
//
// Valor confirmado pelo utilizador em 2026-09-16 (visto no Goldylocks:
// "V/Enc. Nº 202603160"). Gravado aqui como "V/Ref.: 202603160" — o mesmo
// formato normalizado que o extrator já usa independentemente do rótulo de
// origem (ver buildArtigoParts em goldylocksPdfParser.ts), para que
// labelPdfService.ts (que procura pelas chaves "v/ref"/"v/ref.") o
// reconheça exatamente como reconheceria se a OS tivesse sido importada
// depois da correção.
//
// Escrito para ser seguro correr mais do que uma vez: se o texto já
// contiver uma linha "V/Ref." ou "V/Enc." (nesta ou em execuções futuras,
// incluindo se entretanto passar a vir de outra via), não altera nada — só
// esta OS específica é tocada, apenas quando ainda falta a linha.
// ============================================================================

const TARGET_EXTERNAL_ID = "2026/433";
const V_REF_VALUE = "202603160";

export async function fixVRefOS20260916(): Promise<void> {
  try {
    const order = await prisma.serviceOrder.findUnique({ where: { externalId: TARGET_EXTERNAL_ID } });
    if (!order || !order.specifications) return;

    if (/v\s*\/\s*(ref|enc)/i.test(order.specifications)) {
      // Já tem a linha — ou porque este script já correu antes, ou porque
      // entretanto passou a vir de outra via. Nada a fazer.
      return;
    }

    const line = `V/Ref.: ${V_REF_VALUE}`;
    const headerRe = /^Artigo \d+\s*—.*$/gm;
    const hasArtigoHeaders = headerRe.test(order.specifications);

    let updated: string;
    if (hasArtigoHeaders) {
      // Uma OS com vários artigos: acrescenta a linha a seguir ao
      // "Quant.:" de cada bloco de artigo (ou no fim do bloco, se não
      // houver "Quant.:"). O bloco final "Referente a:" (se existir) não
      // começa por "Artigo N —", por isso fica intocado.
      const blocks = order.specifications.split(/\n\n/);
      updated = blocks
        .map((block) => {
          if (!/^Artigo \d+\s*—/.test(block)) return block;
          const quantLineRe = /^(Quant\.:.*)$/m;
          if (quantLineRe.test(block)) {
            return block.replace(quantLineRe, `$1\n${line}`);
          }
          return `${block}\n${line}`;
        })
        .join("\n\n");
    } else {
      // Um só artigo: mesma lógica, sem blocos.
      const quantLineRe = /^(Quant\.:.*)$/m;
      updated = quantLineRe.test(order.specifications)
        ? order.specifications.replace(quantLineRe, `$1\n${line}`)
        : `${order.specifications}\n${line}`;
    }

    await prisma.serviceOrder.update({ where: { id: order.id }, data: { specifications: updated } });
    console.log(
      `[fixVRefOS20260916] Linha "${line}" acrescentada às Características do Produto da OS ${TARGET_EXTERNAL_ID}.`
    );
  } catch (err) {
    // Nunca deve impedir o arranque da aplicação por causa disto.
    console.error("[fixVRefOS20260916] Falhou (a aplicação continua a arrancar normalmente):", err);
  }
}
