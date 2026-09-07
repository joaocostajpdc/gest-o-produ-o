import "dotenv/config";
import { createApp } from "./app";
import { ensureCatalog20260907 } from "./scripts/ensureCatalog20260907";

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
