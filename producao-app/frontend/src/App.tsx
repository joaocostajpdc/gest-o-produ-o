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

function ProtectedArea() {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40 }}>A carregar...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedArea />}>
        <Route path="/" element={<ServiceOrdersListPage />} />
        <Route path="/service-orders/:id" element={<ServiceOrderDetailPage />} />
        <Route path="/material-lacagem" element={<MaterialLacagemPage />} />
        <Route path="/material-a-pedir" element={<MaterialRequestsPage />} />
        <Route path="/reports" element={<PrintableListPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/stages" element={<StagesPage />} />
        <Route path="/production-lines" element={<ProductionLinesPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/users" element={<UsersPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
