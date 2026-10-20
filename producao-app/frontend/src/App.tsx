import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { ServiceOrdersListPage } from "./pages/ServiceOrdersListPage";
import { ServiceOrderDetailPage } from "./pages/ServiceOrderDetailPage";
import { ProductsPage } from "./pages/ProductsPage";
import { StagesPage } from "./pages/StagesPage";
import { ProductionLinesPage } from "./pages/ProductionLinesPage";
import { SuppliersPage } from "./pages/SuppliersPage";
import { UsersPage } from "./pages/UsersPage";
import { PrintableListPage } from "./pages/PrintableListPage";
import { MaterialLacagemPage } from "./pages/MaterialLacagemPage";
import { MaterialRequestsPage } from "./pages/MaterialRequestsPage";
import { ScanPage } from "./pages/ScanPage";
import { PowderStockPage } from "./pages/PowderStockPage";
import { GlassOrdersPage } from "./pages/GlassOrdersPage";
import { OrcamentosPage } from "./pages/OrcamentosPage";
import { ComprasPage } from "./pages/ComprasPage";
import { EmailsPage } from "./pages/EmailsPage";
import { CutPlanNewPage, CutPlanPage, CutPlansPage } from "./pages/CutPlansPage";
import { TelegramPage } from "./pages/TelegramPage";
import { FeaturesProvider, useFeature } from "./contexts/FeaturesContext";
import { HomePage } from "./pages/HomePage";
import { HorasPage } from "./pages/HorasPage";
import { KmPage } from "./pages/KmPage";

function ProtectedArea() {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40 }}>A carregar...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <FeaturesProvider>
      <Layout />
    </FeaturesProvider>
  );
}

// "/" mostra o novo ecrã inicial a quem já o tem (em teste: só o
// administrador); os restantes continuam a ver as Ordens de Serviço.
function RootPage() {
  const inicio = useFeature("inicio");
  if (inicio.loading) return null;
  return inicio.available ? <HomePage /> : <ServiceOrdersListPage />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedArea />}>
        <Route path="/" element={<RootPage />} />
        <Route path="/ordens-servico" element={<ServiceOrdersListPage />} />
        <Route path="/scan" element={<ScanPage />} />
        <Route path="/service-orders/:id" element={<ServiceOrderDetailPage />} />
        <Route path="/material-lacagem" element={<MaterialLacagemPage />} />
        <Route path="/material-a-pedir" element={<MaterialRequestsPage />} />
        <Route path="/po-em-stock" element={<PowderStockPage />} />
        <Route path="/pedidos-vidros" element={<GlassOrdersPage />} />
        <Route path="/otimizacao-corte" element={<CutPlansPage />} />
        <Route path="/otimizacao-corte/novo" element={<CutPlanNewPage />} />
        <Route path="/otimizacao-corte/:id" element={<CutPlanPage />} />
        <Route path="/orcamentos" element={<OrcamentosPage />} />
        <Route path="/compras" element={<ComprasPage />} />
        <Route path="/controlo-horas" element={<HorasPage />} />
        <Route path="/km-carrinhas" element={<KmPage />} />
        <Route path="/reports" element={<PrintableListPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/stages" element={<StagesPage />} />
        <Route path="/production-lines" element={<ProductionLinesPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/avisos-telegram" element={<TelegramPage />} />
        <Route path="/emails-automaticos" element={<EmailsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
