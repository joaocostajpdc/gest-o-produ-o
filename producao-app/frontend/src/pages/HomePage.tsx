import { ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../contexts/AuthContext";
import { useFeature } from "../contexts/FeaturesContext";
import { FeatureTestBanner } from "../components/FeatureTestBanner";
import logoMark from "../assets/logo-mark.png";

// ============================================================================
// Ecrã inicial "Central Minho Ferragens" — pedido do utilizador de 2026-10-20:
// um ecrã de entrada com mosaicos grandes e coloridos (ao estilo do
// Goldylocks) que levam às áreas do programa. Fica em teste só para o
// administrador até ser aprovado (feature "inicio").
// ============================================================================

const S = { width: 34, height: 34, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.1, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

const icons = {
  os: (
    <svg {...S}><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3" /></svg>
  ),
  scan: (
    <svg {...S}><path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3" /><path d="M7 12h10" /></svg>
  ),
  cut: (
    <svg {...S}><rect x="3" y="5" width="18" height="14" rx="1" /><path d="M3 12h18M10 5v7M15 12v7" strokeDasharray="2.5 2" /></svg>
  ),
  lacagem: (
    <svg {...S}><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" /></svg>
  ),
  compras: (
    <svg {...S}><path d="M3 4h2l2.5 11h11L21 7H7" /><circle cx="9" cy="19.5" r="1.5" /><circle cx="17" cy="19.5" r="1.5" /></svg>
  ),
  orcamentos: (
    <svg {...S}><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M15 8.5a3 3 0 1 0 0 5M8.5 10h5M8.5 12.5h5M8 17h8" /></svg>
  ),
  listagens: (
    <svg {...S}><path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M6 14h12v7H6z" /></svg>
  ),
};

interface Tile {
  to: string;
  title: string;
  sub: ReactNode;
  icon: ReactNode;
  bg: string;
  fg?: string;
}

function TileLink({ t }: { t: Tile }) {
  const fg = t.fg ?? "#ffffff";
  return (
    <Link to={t.to} className="home-tile" style={{ background: t.bg, color: fg }}>
      <span className="home-tile-icon" style={{ borderColor: fg }}>{t.icon}</span>
      <span className="home-tile-title">{t.title}</span>
      <span className="home-tile-sub">{t.sub}</span>
    </Link>
  );
}

export function HomePage() {
  const { user } = useAuth();
  const inicio = useFeature("inicio");
  const cutPlans = useFeature("cutPlans");
  const compras = useFeature("compras");
  const orcamentos = useFeature("orcamentos");
  const [emCurso, setEmCurso] = useState<number | null>(null);

  useEffect(() => {
    api
      .get<{ status: string }[]>("/service-orders")
      .then((list) => setEmCurso(list.filter((o) => ["NAO_INICIADA", "EM_PRODUCAO", "SUSPENSA"].includes(o.status)).length))
      .catch(() => setEmCurso(null));
  }, []);

  const tiles: Tile[] = [
    { to: "/ordens-servico", title: "Ordens de Serviço", sub: "Lançar OS, prioridades e prazos", icon: icons.os, bg: "#0b6fa8" },
    { to: "/scan", title: "Ler Código", sub: "Dar entrada e saída por código", icon: icons.scan, bg: "#1f8a4c" },
  ];
  if (cutPlans.available) tiles.push({ to: "/otimizacao-corte", title: "Planos de Corte", sub: "Mosquiteiras, chapas e perfis", icon: icons.cut, bg: "#6247b8" });
  tiles.push({ to: "/material-lacagem", title: "Material em Lacagem", sub: "O que está fora a lacar", icon: icons.lacagem, bg: "#0e7c86" });
  tiles.push(
    compras.available
      ? { to: "/compras", title: "Compras", sub: "Pedidos a fornecedores e material", icon: icons.compras, bg: "#d4561a" }
      : { to: "/material-a-pedir", title: "Material a Pedir", sub: "Pedidos a fornecedores", icon: icons.compras, bg: "#d4561a" }
  );
  if (orcamentos.available) tiles.push({ to: "/orcamentos", title: "Orçamentação", sub: "Painéis e chapas quinadas · acesso restrito", icon: icons.orcamentos, bg: "#f6bd2c", fg: "#2a1f00" });
  tiles.push({ to: "/reports", title: "Listagens", sub: "Listas para imprimir", icon: icons.listagens, bg: "#3b4a63" });

  return (
    <div>
      {!inicio.released && <FeatureTestBanner featureKey="inicio" label="o novo ecrã inicial" />}

      <div className="home-head">
        <div className="home-company">
          <img src={logoMark} alt="Minho Ferragens" />
          <div>
            <div className="home-company-name">JPDC - MYNHOFERRAGENS LDA</div>
            <div className="muted" style={{ fontSize: 13 }}>
              Olá{user?.name ? `, ${user.name.split(" ")[0]}` : ""} · Produção · Orçamentação · Compras
            </div>
          </div>
        </div>
        <div className="home-stat">
          <span>
            Ordens em curso: <strong>{emCurso ?? "—"}</strong>
          </span>
          <Link to="/ordens-servico" className="btn secondary" style={{ fontSize: 13 }}>
            Ver ordens de serviço
          </Link>
        </div>
      </div>

      <div className="home-grid">
        {tiles.map((t) => (
          <TileLink key={t.to} t={t} />
        ))}
      </div>

      <p className="home-foot">
        <strong>Central Minho Ferragens</strong> · Produção, orçamentação e compras
      </p>
    </div>
  );
}
