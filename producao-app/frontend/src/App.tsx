import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { FeaturesProvider } from "./contexts/FeaturesContext";
import { protectedRoutes } from "./appRoutes";

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

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedArea />}>{protectedRoutes}</Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
