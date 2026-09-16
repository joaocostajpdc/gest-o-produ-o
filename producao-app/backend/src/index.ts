import "dotenv/config";
import { createApp } from "./app";
import { ensureCatalog20260907 } from "./scripts/ensureCatalog20260907";
import { fixVRefOS20260916 } from "./scripts/fixVRefOS20260916";

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
