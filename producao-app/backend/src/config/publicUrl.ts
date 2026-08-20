// URL pública onde a aplicação está acessível — usada para construir links
// que precisam de funcionar fora da aplicação (ex.: o código QR das
// etiquetas de produto, que ao ser lido num telemóvel deve abrir a página
// da Ordem de Serviço). Configurável por variável de ambiente para
// ambientes diferentes do de produção (local, staging, etc.).
export const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL || "https://gestao-producao.onrender.com").replace(
  /\/+$/,
  ""
);
