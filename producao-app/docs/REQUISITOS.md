# Proposta de Alteração AppProdução — Requisitos Funcionais

> Cópia em texto do documento fornecido (`Proposta_Alteração_AppProdução.v3.docx`),
> incluída para referência ao ler o código deste projeto.

## 1. Objetivo

O presente documento tem como objetivo definir os requisitos funcionais para a evolução da aplicação de gestão da produção, de forma a melhorar o controlo operacional das ordens de serviço, a rastreabilidade dos processos produtivos e a monitorização dos prazos de execução.

A solução deverá centralizar toda a informação relevante associada à produção, disponibilizando mecanismos de acompanhamento, consulta, filtragem e análise que contribuam para uma gestão mais eficiente dos recursos produtivos.

### 1.1 Origem e Integração das Ordens de Serviço

As Ordens de Serviço utilizadas pela aplicação de gestão da produção são criadas no software de faturação (Goldylocks) existente, não sendo a sua criação realizada diretamente nesta aplicação.

A aplicação de produção deverá manter a integração atualmente existente com o software de faturação, através da qual as Ordens de Serviço são disponibilizadas e associadas aos respetivos clientes e produtos.

As funcionalidades descritas no presente documento aplicam-se às Ordens de Serviço após a sua disponibilização na aplicação de produção.

## 2. Gestão de Produtos

### 2.1 Produtos

Num ambiente produtivo onde coexistem múltiplas ordens de serviço em execução, torna-se fundamental garantir a correta identificação e acompanhamento de cada produto. A aplicação deverá centralizar toda a informação relevante associada a cada produto, permitindo uma consulta rápida, clara e organizada ao longo de todo o processo produtivo.

### 2.2 Categorias de Produtos

Embora cada produto apresente características próprias, existem conjuntos de produtos que partilham processos de fabrico e especificações semelhantes. A aplicação deverá permitir a criação e gestão de categorias de produtos, possibilitando a associação de cada produto a uma categoria previamente definida. Por exemplo, dois painéis com as mesmas dimensões e enchimento, mas com acabamentos diferentes, deverão poder ser enquadrados na categoria "Painéis Lisos", desde que o respetivo processo produtivo seja substancialmente semelhante.

Requisitos: criação de categorias de produtos; associação de produtos a categorias; edição e manutenção das categorias existentes; utilização das categorias como elemento estruturante dos processos produtivos.

## 3. Gestão dos Prazos de Produção

### 3.1 Prazo de Produção por Categoria

O controlo dos prazos de produção constitui um dos principais indicadores de desempenho operacional. A aplicação deverá permitir definir um prazo de produção padrão para cada categoria de produto, possibilitando o cálculo automático da respetiva data-limite de conclusão.

### 3.2 Monitorização Visual dos Prazos

A aplicação deverá disponibilizar um mecanismo visual de acompanhamento dos prazos de produção através de um código de cores, permitindo identificar de forma imediata o grau de urgência de cada ordem de serviço. A prioridade é determinada automaticamente com base na proximidade da data-limite, considerando, no mínimo: prazo ultrapassado; prazo a decorrer com elevada urgência; prazo próximo; prazo com margem suficiente. As Ordens de Serviço são apresentadas por ordem decrescente de prioridade, com ordenação automática aplicada a todas as listagens e vistas.

### 3.3 Tempo Total de Produção

A aplicação deverá registar automaticamente o tempo total de produção de cada ordem de serviço desde o início até à sua conclusão, permanecendo disponível para consulta histórica e análise de desempenho.

## 4. Gestão das Etapas de Produção

### 4.1 Estados da Ordem de Serviço

Estados configuráveis, contemplando numa primeira implementação: não iniciada; em produção; suspensa; concluída; cancelada. Atualização automática sempre que ocorram determinadas ações, sem prejuízo de alteração manual por utilizadores com permissões adequadas.

### 4.2 Tempo por Etapa

Monitorização do tempo de permanência de cada OS em cada etapa: determinar há quanto tempo uma OS permanece numa etapa; identificar bloqueios/atrasos; produzir indicadores de desempenho por etapa.

### 4.3 Distinção entre Tempo de Produção e Tempo de Permanência

- **Tempo de Produção** — período efetivamente contabilizado como produção, excluindo suspensões.
- **Tempo de Permanência** — período total numa etapa, desde a entrada até à saída, independentemente de a produção estar ativa ou suspensa.

Exemplo: uma OS permanece 8h na etapa de Fresagem, mas esteve efetivamente em produção 5h e suspensa 3h (tempo de permanência: 8h; tempo de produção: 5h; tempo de interrupção: 3h).

### 4.4 Interrupções de Produção

Suspender e retomar a contagem do tempo de produção. Motivo obrigatório, selecionado de lista pré-configurada (falta de matéria-prima, avaria de equipamento, falta de capacidade, aguardar informação, aguardar aprovação, aguardar fornecedor, problema de qualidade, outro — com descrição adicional). Cada interrupção regista automaticamente: data/hora de início e fim, duração, motivo, utilizador.

## 5. Gestão de Clientes

Cada OS associada ao respetivo cliente via integração com o software de faturação. Permite: identificar rapidamente o cliente; distinguir produtos visualmente semelhantes; facilitar pesquisas/filtragens; melhorar a rastreabilidade.

## 6. Observações de Produção

Campo de observações por OS, com registo automático de data, hora e utilizador responsável. Histórico editável e consultável a qualquer momento.

## 7. Histórico Global da Ordem de Serviço

Histórico cronológico de todas as alterações e eventos relevantes: criação/entrada da OS; alterações de estado; entrada/saída de etapas; início/fim de interrupções e motivos; alterações da linha de produção; inserção/alteração de etapas; encaminhamento para fornecedores; envio/retorno de trabalhos externos; observações; alterações relevantes por utilizadores. Cada evento regista: data, hora, utilizador, tipo de evento, informação da alteração.

## 8. Estrutura Produtiva

### 8.1 Etapas e Linhas de Produção

Configuração e gestão de todas as etapas e linhas de produção necessárias ao fabrico de cada categoria.

### 8.2 Etapas de Produção

Cada categoria possui um conjunto próprio de etapas previamente configuradas. Permite: visualizar OS presentes em cada etapa; consultar estado de execução; analisar carga de trabalho por setor; identificar estrangulamentos.

## 9. Gestão de Fornecedores

Determinadas etapas podem exigir fornecedores externos (ex.: lacagem). Permite: associar fornecedores a etapas; identificar o fornecedor responsável por cada OS; consultar histórico de fornecimentos; acompanhar a localização dos trabalhos externos.

## 10. Gestão de Utilizadores e Permissões

Perfis de utilizador (mínimo três): **Administrador** (acesso total e gestão da configuração), **Supervisor** (gestão e acompanhamento da produção), **Operário** (execução e consulta das operações produtivas). Tabela de permissões mínimas por funcionalidade; operações não autorizadas não disponíveis ao respetivo perfil. Todas as alterações ficam associadas ao utilizador responsável.

## 11. Linhas de Produção

### 11.1 Definição

Sequência de etapas que cada categoria deverá percorrer até à conclusão, parametrizável por categoria.

### 11.2 Linhas de Produção Predefinidas

Cada categoria possui uma linha predefinida; ao iniciar, a OS é posicionada automaticamente na primeira etapa; a progressão segue a sequência estabelecida.

### 11.3 Alterações Pontuais ao Fluxo de Produção

Em situações excecionais: avançar etapas; regressar a etapas anteriores; inserir etapas adicionais; omitir etapas específicas; alterar temporariamente o fluxo. Afeta exclusivamente a OS em causa, sem alterar a linha predefinida da categoria. Após alteração manual, disponibiliza-se a opção "Voltar à Linha de Produção", com escolha da etapa a partir da qual retomar o fluxo original.

## 12. Pesquisa, Filtragem e Listagens

Filtros por: prioridade (com data-limite como critério secundário); etapa de produção; categoria; fornecedor; cliente. Listagens imprimíveis com base nos filtros aplicados, adequadas para reuniões de acompanhamento, planeamento diário, distribuição entre setores e consulta offline.

## 13. Resumo dos Requisitos Funcionais

A aplicação deverá permitir: gerir categorias de produtos; definir prazos de produção por categoria; monitorizar tempos totais e por etapa; suspender e retomar cronometragens; associar clientes às OS; registar observações com histórico auditável; configurar etapas e linhas de produção; associar fornecedores às etapas; alterar pontualmente fluxos de produção; retomar fluxos predefinidos; filtrar por prioridade/etapa/categoria/fornecedor/cliente; gerar listagens imprimíveis com base em filtros.

Este conjunto de funcionalidades visa aumentar a rastreabilidade, o controlo operacional e a eficiência global do processo produtivo.
