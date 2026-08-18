# App de Gestão de Produção — Código-fonte de arranque

Este projeto é um ponto de partida (starter codebase) para a evolução da
aplicação de gestão de produção descrita em `docs/REQUISITOS.md` (cópia do
documento "Proposta de Alteração AppProdução"). Cobre a modelação de dados e
as regras de negócio de **todas** as secções do documento, com uma interface
funcional para validar o fluxo — não é um produto pronto para produção:
faltam testes automatizados, hardening de segurança, revisão de UX e a
integração real com o Goldylocks (ver secção "O que falta fazer").

## Stack

- **Backend:** Node.js + Express + TypeScript, Prisma ORM, PostgreSQL, autenticação JWT.
- **Frontend:** React + TypeScript + Vite, React Router, fetch nativo (sem framework de estado adicional).
- **Base de dados:** PostgreSQL (via Docker Compose para desenvolvimento local).

## Como correr localmente

### 1. Base de dados

```bash
docker compose up -d
```

### 2. Backend

```bash
cd backend
cp .env.example .env
npm install
npm run prisma:migrate   # cria as tabelas
npm run prisma:seed      # dados de exemplo (categorias, produtos, OS, utilizadores)
npm run dev               # http://localhost:4000
```

Utilizadores de demonstração criados pelo seed (palavra-passe `producao123` para todos):

| Perfil | Email |
|---|---|
| Administrador | admin@producao.local |
| Supervisor | supervisor@producao.local |
| Operário | operario@producao.local |

### 3. Frontend

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173 (proxy para a API em /api)
```

## Arquitetura

```
backend/
  prisma/schema.prisma        modelo de dados completo (ver abaixo)
  prisma/seed.ts               dados de exemplo
  src/
    config/permissions.ts      matriz de permissões por perfil (Tabela 6 do documento)
    middleware/                autenticação JWT + autorização por permissão
    integrations/goldylocks/   adaptador de integração (mock + stub real, interface comum)
    services/                  regras de negócio (prioridade, tempos, fluxo de etapas, histórico)
    routes/                    rotas REST por recurso
frontend/
  src/
    api/client.ts               wrapper fetch com token JWT
    contexts/AuthContext.tsx    sessão + réplica leve de permissões para a UI
    pages/                      um ficheiro por ecrã principal
    components/                 badges de estado/prioridade, layout
```

### Decisões de modelação relevantes

- **Ordens de Serviço** são sempre criadas no Goldylocks; a aplicação só as
  **importa** (`POST /api/service-orders/import`, botão "Importar do
  Goldylocks" na listagem). O adaptador mock (`integrations/goldylocks/mockAdapter.ts`)
  simula esse catálogo; o `realAdapter.stub.ts` está pronto a ser implementado
  quando o mecanismo real (API? BD partilhada? ficheiros?) for definido —
  troca-se via `GOLDYLOCKS_ADAPTER=real` no `.env`, sem alterar o resto do código.

- **Linha de produção predefinida por categoria** (`ProductionLineStep`) vs.
  **instâncias de etapa por Ordem de Serviço** (`ServiceOrderStageInstance`):
  ao criar uma OS, a sequência predefinida é copiada para instâncias próprias
  dessa OS, o que permite alterações pontuais (avançar, recuar, inserir,
  omitir, retomar) sem afetar a linha predefinida da categoria nem outras OS.

- **Tempo de produção vs. tempo de permanência**: `ServiceOrder.productionMinutes`
  acumula apenas os períodos em produção ativa (é congelado durante
  interrupções); `ServiceOrderStageInstance.enteredAt/exitedAt` mede o tempo de
  permanência bruto em cada etapa, independentemente de suspensões — replica
  o exemplo do documento (8h de permanência, 5h de produção, 3h de interrupção).

- **Permissões**: centralizadas em `config/permissions.ts` (matriz
  perfil → permissão), aplicada tanto no backend (`middleware/permissions.ts`)
  como, de forma leve, no frontend para ocultar ações não permitidas. A fonte
  da verdade é sempre o backend.

## Mapeamento aos requisitos do documento

| Secção do documento | Onde está no código |
|---|---|
| Origem e Integração das OS | `integrations/goldylocks/*`, `services/serviceOrderService.ts` |
| Categorias de Produtos | `ProductCategory` (schema), `routes/categories.ts`, `pages/CategoriesPage.tsx` |
| Prazo de Produção por Categoria | `ProductCategory.defaultProductionHours`, cálculo em `serviceOrderService.ts` |
| Monitorização Visual dos Prazos (cores/prioridade) | `services/priorityService.ts` |
| Tempo Total de Produção | `services/timeTrackingService.ts` |
| Estados da OS | `ServiceOrderStatus` (schema), ações em `routes/serviceOrders.ts` |
| Tempo por Etapa / Permanência vs. Produção | `services/timeTrackingService.ts`, `ServiceOrderStageInstance` |
| Interrupções de Produção | `services/interruptionService.ts`, `InterruptionReason` (schema) |
| Gestão de Clientes | `Client` (schema), `routes/clients.ts` |
| Observações de Produção | `Observation` (schema), endpoints em `routes/serviceOrders.ts` |
| Histórico Global da OS | `services/historyService.ts`, `HistoryEvent` (schema) |
| Etapas e Linhas de Produção | `Stage`, `ProductionLineStep` (schema), `routes/stages.ts` |
| Gestão de Fornecedores | `Supplier` (schema), `routes/suppliers.ts` |
| Gestão de Utilizadores e Permissões | `User`, `config/permissions.ts`, `routes/users.ts` |
| Alterações Pontuais ao Fluxo / Voltar à Linha de Produção | `services/stageFlowService.ts` |
| Pesquisa, Filtragem e Listagens | filtros em `routes/serviceOrders.ts`, `routes/reports.ts` |

## O que falta fazer antes de produção

1. **Integração real com o Goldylocks** — implementar `GoldylocksRealAdapter`
   quando o mecanismo estiver definido (API, BD, ficheiros, etc.).
2. **Testes automatizados** — não há testes unitários/integração; as regras
   mais críticas para cobrir primeiro são `priorityService`, `timeTrackingService`
   e `stageFlowService`.
3. **Migrações Prisma versionadas** — corre `prisma migrate dev` para gerar a
   primeira migração antes de usar em equipa.
4. **Refinar UX** — esta interface é funcional mas minimalista; falta
   validação de formulários mais rica, paginação em listagens grandes,
   confirmações mais elegantes (atualmente usa `window.confirm`/`window.prompt`).
5. **Segurança** — rotação de `JWT_SECRET`, políticas de password, rate
   limiting no login, logs de auditoria de acesso.
6. **Notificações** — o documento não pede, mas alertas (email/push) para OS
   que ultrapassem o prazo seriam um complemento natural à monitorização visual.
