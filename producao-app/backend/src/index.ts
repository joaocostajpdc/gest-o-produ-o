import "dotenv/config";
import { createApp } from "./app";
import { ensureCatalog20260907 } from "./scripts/ensureCatalog20260907";
import { fixVRefOS20260916 } from "./scripts/fixVRefOS20260916";
import { startEmailScheduler } from "./services/emailReportsService";
import { goldylocksProbe } from "./scripts/goldylocksProbe";
import { announceTelegram } from "./scripts/announceTelegram";
import { launchOS20261029 } from "./scripts/launchOS20261029";
import { rereadPdfs20261029 } from "./scripts/rereadPdfs20261029";
import { attachGuia20261030 } from "./scripts/attachGuia20261030";
import { attachGuia20261030b } from "./scripts/attachGuia20261030b";
import { objetivos20261030 } from "./scripts/objetivos20261030";

const port = Number(process.env.PORT ?? 4000);
const app = createApp();

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API da aplicação de gestão de produção a correr em http://localhost:${port}`);
});

// Lançamento pontual de artigos pedido pelo utilizador (ver
// scripts/ensureCatalog20260907.ts) — corre depois do servidor já estar a
// aceitar pedidos, sem bloquear o arranque, e é seguro correr em todos os
// arranques seguintes (não duplica nada).
void ensureCatalog20260907();

// Correção pontual da OS 2026/433 (ver scripts/fixVRefOS20260916.ts) — mesmo
// padrão do script acima: corre em todos os arranques, mas só escreve uma
// vez (a segunda execução em diante não encontra nada para corrigir).
void fixVRefOS20260916();

// Emails automáticos semanais (OS a terminar e material das lacagens) —
// verifica a cada 5 minutos se há algum por enviar (ver emailReportsService).
startEmailScheduler();

// Aviso geral pontual por Telegram (só com TELEGRAM_ANNOUNCE definido; não repete).
void announceTelegram();

// Lançamento pontual das OS 2026/557 e 2026/558 na Lacagem (Alumiasas) — 2026-10-29.
void launchOS20261029();

// Releitura pontual dos PDFs das OS abertas com a leitura melhorada (uma só vez).
void rereadPdfs20261029();
void attachGuia20261030();
void attachGuia20261030b();
void objetivos20261030();

// Sonda temporária da API do Goldylocks (só com GOLDYLOCKS_PROBE=1).
void goldylocksProbe();
