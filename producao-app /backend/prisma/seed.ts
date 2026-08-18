import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

// ============================================================================
// Seed de dados de exemplo
//
// Popula: utilizadores (3 perfis), catálogo de etapas, categorias com linhas
// de produção predefinidas, produtos (alinhados com os IDs simulados do
// adaptador mock do Goldylocks), fornecedores, clientes e um conjunto de
// Ordens de Serviço em diferentes estados/prioridades para demonstração.
//
// Corre com: npm run prisma:seed  (dentro de backend/)
// ============================================================================

const prisma = new PrismaClient();

async function main() {
  console.log("A limpar dados existentes...");
  await prisma.historyEvent.deleteMany();
  await prisma.observation.deleteMany();
  await prisma.interruption.deleteMany();
  await prisma.serviceOrderStageInstance.deleteMany();
  await prisma.serviceOrder.deleteMany();
  await prisma.productionLineStep.deleteMany();
  await prisma.product.deleteMany();
  await prisma.productCategory.deleteMany();
  await prisma.stage.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.client.deleteMany();
  await prisma.user.deleteMany();

  console.log("A criar utilizadores...");
  const passwordHash = await bcrypt.hash("producao123", 10);
  const [admin, supervisor, operario] = await Promise.all([
    prisma.user.create({
      data: { name: "Ana Administradora", email: "admin@producao.local", passwordHash, role: "ADMINISTRADOR" },
    }),
    prisma.user.create({
      data: { name: "Sérgio Supervisor", email: "supervisor@producao.local", passwordHash, role: "SUPERVISOR" },
    }),
    prisma.user.create({
      data: { name: "Óscar Operário", email: "operario@producao.local", passwordHash, role: "OPERARIO" },
    }),
  ]);
  console.log("   Password para todos os utilizadores de demonstração: producao123");

  console.log("A criar etapas...");
  const [corte, fresagem, lacagem, controloQualidade, embalagem] = await Promise.all([
    prisma.stage.create({ data: { name: "Corte" } }),
    prisma.stage.create({ data: { name: "Fresagem" } }),
    prisma.stage.create({ data: { name: "Lacagem", requiresSupplier: true } }),
    prisma.stage.create({ data: { name: "Controlo de Qualidade" } }),
    prisma.stage.create({ data: { name: "Embalagem" } }),
  ]);

  console.log("A criar fornecedores...");
  const [lacasDoNorte, acabamentosSul] = await Promise.all([
    prisma.supplier.create({ data: { name: "Lacas do Norte, Lda", contact: "Fábio Nunes", phone: "912345678" } }),
    prisma.supplier.create({ data: { name: "Acabamentos Sul", contact: "Rita Costa", phone: "913456789" } }),
  ]);

  console.log("A criar categorias e linhas de produção...");
  const categoriaPaineisLisos = await prisma.productCategory.create({
    data: { name: "Painéis Lisos", description: "Painéis lisos de várias dimensões e acabamentos.", defaultProductionHours: 48 },
  });
  const categoriaPainelFresado = await prisma.productCategory.create({
    data: { name: "Painel Fresado", description: "Painéis com fresagem decorativa.", defaultProductionHours: 72 },
  });
  const categoriaPortasLacadas = await prisma.productCategory.create({
    data: { name: "Portas Lacadas", description: "Portas com acabamento lacado, subcontratado.", defaultProductionHours: 96 },
  });

  await prisma.productionLineStep.createMany({
    data: [
      { categoryId: categoriaPaineisLisos.id, stageId: corte.id, order: 1 },
      { categoryId: categoriaPaineisLisos.id, stageId: controloQualidade.id, order: 2 },
      { categoryId: categoriaPaineisLisos.id, stageId: embalagem.id, order: 3 },

      { categoryId: categoriaPainelFresado.id, stageId: corte.id, order: 1 },
      { categoryId: categoriaPainelFresado.id, stageId: fresagem.id, order: 2 },
      { categoryId: categoriaPainelFresado.id, stageId: controloQualidade.id, order: 3 },
      { categoryId: categoriaPainelFresado.id, stageId: embalagem.id, order: 4 },

      { categoryId: categoriaPortasLacadas.id, stageId: corte.id, order: 1 },
      { categoryId: categoriaPortasLacadas.id, stageId: lacagem.id, order: 2, defaultSupplierId: lacasDoNorte.id },
      { categoryId: categoriaPortasLacadas.id, stageId: controloQualidade.id, order: 3 },
      { categoryId: categoriaPortasLacadas.id, stageId: embalagem.id, order: 4 },
    ],
  });

  console.log("A criar produtos (alinhados com o catálogo simulado do Goldylocks)...");
  const [painelLiso, painelFresadoClassico, painelFresadoModerno, portaLacada] = await Promise.all([
    prisma.product.create({
      data: { externalId: "PRD-100", name: "Painel Liso 2400x1200", categoryId: categoriaPaineisLisos.id },
    }),
    prisma.product.create({
      data: { externalId: "PRD-101", name: "Painel Fresado Clássico", categoryId: categoriaPainelFresado.id },
    }),
    prisma.product.create({
      data: { externalId: "PRD-102", name: "Painel Fresado Moderno", categoryId: categoriaPainelFresado.id },
    }),
    prisma.product.create({
      data: { externalId: "PRD-103", name: "Porta Lacada Branca", categoryId: categoriaPortasLacadas.id },
    }),
  ]);

  console.log("A criar clientes (espelhando o catálogo simulado do Goldylocks)...");
  const [clienteSilva, clienteInteriores, clienteAlmeida, clienteStudio] = await Promise.all([
    prisma.client.create({ data: { externalId: "CLI-001", name: "Marcenaria Silva & Filhos", taxNumber: "500123456" } }),
    prisma.client.create({ data: { externalId: "CLI-002", name: "Interiores Modernos, Lda", taxNumber: "501234567" } }),
    prisma.client.create({ data: { externalId: "CLI-003", name: "Construções Almeida", taxNumber: "502345678" } }),
    prisma.client.create({ data: { externalId: "CLI-004", name: "Studio Decor", taxNumber: "503456789" } }),
  ]);

  const now = Date.now();
  const hours = (h: number) => new Date(now + h * 60 * 60 * 1000);

  console.log("A criar Ordens de Serviço de demonstração...");

  // OS-2001: Não iniciada, prazo confortável (COM_MARGEM).
  const os2001 = await prisma.serviceOrder.create({
    data: {
      externalId: "OS-2001",
      clientId: clienteSilva.id,
      productId: painelLiso.id,
      categoryId: categoriaPaineisLisos.id,
      status: "NAO_INICIADA",
      deadlineAt: hours(96),
    },
  });
  await prisma.serviceOrderStageInstance.createMany({
    data: [
      { serviceOrderId: os2001.id, stageId: corte.id, order: 10, status: "PENDENTE" },
      { serviceOrderId: os2001.id, stageId: controloQualidade.id, order: 20, status: "PENDENTE" },
      { serviceOrderId: os2001.id, stageId: embalagem.id, order: 30, status: "PENDENTE" },
    ],
  });
  await prisma.historyEvent.create({
    data: { serviceOrderId: os2001.id, type: "CRIACAO", description: 'Ordem de Serviço "OS-2001" importada do Goldylocks.' },
  });

  // OS-2002: Em produção (Fresagem ativa), prazo urgente (URGENTE, <=24h).
  const os2002 = await prisma.serviceOrder.create({
    data: {
      externalId: "OS-2002",
      clientId: clienteInteriores.id,
      productId: painelFresadoClassico.id,
      categoryId: categoriaPainelFresado.id,
      status: "EM_PRODUCAO",
      deadlineAt: hours(20),
      startedAt: hours(-10),
      lastResumedAt: hours(-6),
      productionMinutes: 240, // 4h já consolidadas na etapa de Corte
    },
  });
  const os2002Corte = await prisma.serviceOrderStageInstance.create({
    data: { serviceOrderId: os2002.id, stageId: corte.id, order: 10, status: "CONCLUIDA", enteredAt: hours(-10), exitedAt: hours(-6) },
  });
  const os2002Fresagem = await prisma.serviceOrderStageInstance.create({
    data: { serviceOrderId: os2002.id, stageId: fresagem.id, order: 20, status: "ATIVA", enteredAt: hours(-6) },
  });
  await prisma.serviceOrderStageInstance.createMany({
    data: [
      { serviceOrderId: os2002.id, stageId: controloQualidade.id, order: 30, status: "PENDENTE" },
      { serviceOrderId: os2002.id, stageId: embalagem.id, order: 40, status: "PENDENTE" },
    ],
  });
  await prisma.serviceOrder.update({ where: { id: os2002.id }, data: { currentStageInstanceId: os2002Fresagem.id } });
  await prisma.historyEvent.createMany({
    data: [
      { serviceOrderId: os2002.id, type: "CRIACAO", description: 'Ordem de Serviço "OS-2002" importada do Goldylocks.', createdAt: hours(-10) },
      { serviceOrderId: os2002.id, type: "ALTERACAO_ESTADO", description: "Produção iniciada.", createdAt: hours(-10) },
      { serviceOrderId: os2002.id, type: "ENTRADA_ETAPA", description: 'Entrada na etapa "Corte".', createdAt: hours(-10) },
      { serviceOrderId: os2002.id, type: "SAIDA_ETAPA", description: 'Saída da etapa "Corte".', createdAt: hours(-6) },
      { serviceOrderId: os2002.id, type: "ENTRADA_ETAPA", description: 'Entrada na etapa "Fresagem".', createdAt: hours(-6) },
    ],
  });
  await prisma.observation.create({
    data: { serviceOrderId: os2002.id, text: "Cliente pediu para confirmar acabamento antes da lacagem.", userId: supervisor.id, createdAt: hours(-5) },
  });

  // OS-2003: Suspensa (Lacagem, avaria de equipamento), prazo ultrapassado.
  const os2003 = await prisma.serviceOrder.create({
    data: {
      externalId: "OS-2003",
      clientId: clienteAlmeida.id,
      productId: portaLacada.id,
      categoryId: categoriaPortasLacadas.id,
      status: "SUSPENSA",
      deadlineAt: hours(-2),
      startedAt: hours(-30),
      lastResumedAt: null,
      productionMinutes: 180,
    },
  });
  const os2003Corte = await prisma.serviceOrderStageInstance.create({
    data: { serviceOrderId: os2003.id, stageId: corte.id, order: 10, status: "CONCLUIDA", enteredAt: hours(-30), exitedAt: hours(-27) },
  });
  const os2003Lacagem = await prisma.serviceOrderStageInstance.create({
    data: {
      serviceOrderId: os2003.id,
      stageId: lacagem.id,
      order: 20,
      status: "ATIVA",
      enteredAt: hours(-27),
      supplierId: lacasDoNorte.id,
    },
  });
  await prisma.serviceOrderStageInstance.createMany({
    data: [
      { serviceOrderId: os2003.id, stageId: controloQualidade.id, order: 30, status: "PENDENTE" },
      { serviceOrderId: os2003.id, stageId: embalagem.id, order: 40, status: "PENDENTE" },
    ],
  });
  await prisma.serviceOrder.update({ where: { id: os2003.id }, data: { currentStageInstanceId: os2003Lacagem.id } });
  const interrupcao2003 = await prisma.interruption.create({
    data: {
      serviceOrderId: os2003.id,
      reason: "AVARIA_EQUIPAMENTO",
      userId: operario.id,
      startedAt: hours(-3),
    },
  });
  await prisma.historyEvent.createMany({
    data: [
      { serviceOrderId: os2003.id, type: "CRIACAO", description: 'Ordem de Serviço "OS-2003" importada do Goldylocks.', createdAt: hours(-30) },
      { serviceOrderId: os2003.id, type: "ENTRADA_ETAPA", description: 'Entrada na etapa "Lacagem" (fornecedor: Lacas do Norte, Lda).', createdAt: hours(-27) },
      {
        serviceOrderId: os2003.id,
        type: "INICIO_INTERRUPCAO",
        description: "Interrupção iniciada. Motivo: AVARIA_EQUIPAMENTO.",
        userId: operario.id,
        metadata: { interruptionId: interrupcao2003.id, reason: "AVARIA_EQUIPAMENTO" },
        createdAt: hours(-3),
      },
    ],
  });

  // OS-2004: Concluída.
  const os2004 = await prisma.serviceOrder.create({
    data: {
      externalId: "OS-2004",
      clientId: clienteStudio.id,
      productId: painelFresadoModerno.id,
      categoryId: categoriaPainelFresado.id,
      status: "CONCLUIDA",
      deadlineAt: hours(-48),
      startedAt: hours(-96),
      completedAt: hours(-50),
      productionMinutes: 2340,
    },
  });
  await prisma.serviceOrderStageInstance.createMany({
    data: [
      { serviceOrderId: os2004.id, stageId: corte.id, order: 10, status: "CONCLUIDA", enteredAt: hours(-96), exitedAt: hours(-84) },
      { serviceOrderId: os2004.id, stageId: fresagem.id, order: 20, status: "CONCLUIDA", enteredAt: hours(-84), exitedAt: hours(-66) },
      { serviceOrderId: os2004.id, stageId: controloQualidade.id, order: 30, status: "CONCLUIDA", enteredAt: hours(-66), exitedAt: hours(-58) },
      { serviceOrderId: os2004.id, stageId: embalagem.id, order: 40, status: "CONCLUIDA", enteredAt: hours(-58), exitedAt: hours(-50) },
    ],
  });
  await prisma.historyEvent.createMany({
    data: [
      { serviceOrderId: os2004.id, type: "CRIACAO", description: 'Ordem de Serviço "OS-2004" importada do Goldylocks.', createdAt: hours(-96) },
      { serviceOrderId: os2004.id, type: "ALTERACAO_ESTADO", description: "Todas as etapas concluídas. Ordem de Serviço concluída.", createdAt: hours(-50) },
    ],
  });

  // OS-2005: Cancelada.
  const os2005 = await prisma.serviceOrder.create({
    data: {
      externalId: "OS-2005",
      clientId: clienteSilva.id,
      productId: painelLiso.id,
      categoryId: categoriaPaineisLisos.id,
      status: "CANCELADA",
      deadlineAt: hours(72),
    },
  });
  await prisma.historyEvent.createMany({
    data: [
      { serviceOrderId: os2005.id, type: "CRIACAO", description: 'Ordem de Serviço "OS-2005" importada do Goldylocks.', createdAt: hours(-1) },
      { serviceOrderId: os2005.id, type: "ALTERACAO_ESTADO", description: "Ordem de Serviço cancelada. Motivo: Cliente cancelou a encomenda.", userId: admin.id, createdAt: hours(-0.5) },
    ],
  });

  console.log("Seed concluído.");
  console.log("");
  console.log("Utilizadores de demonstração:");
  console.log(`  Administrador: ${admin.email} / producao123`);
  console.log(`  Supervisor:    ${supervisor.email} / producao123`);
  console.log(`  Operário:      ${operario.email} / producao123`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
