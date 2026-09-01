import { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { api } from "../api/client";
import { ServiceOrderListItem } from "../types";

// ============================================================================
// Ler Código — lê o código de barras impresso na Etiqueta de Código de
// Barras (ver labelPdfService.ts no backend) através da câmara do
// telemóvel/tablet, diretamente na aplicação, e abre a OS correspondente.
//
// Um código de barras (ao contrário de um QR de URL) não tem capacidade de
// "abrir" nada sozinho ao ser fotografado — por isso a leitura tem de
// acontecer aqui dentro, que localiza a OS pelo número lido e navega até
// ela (ver decisão confirmada pelo utilizador em 2026-09-01: "dentro da
// app fazemos a leitura do codigo de barras").
//
// Aceita também códigos QR (a par do código de barras Code128), para não
// deixar de funcionar em etiquetas QR mais antigas já impressas.
//
// Inclui sempre um campo de texto para introduzir o número manualmente,
// como alternativa quando a câmara não está disponível ou a leitura falha.
// ============================================================================

const READER_ELEMENT_ID = "barcode-scanner-viewport";

export function ScanPage() {
  const navigate = useNavigate();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [manualCode, setManualCode] = useState("");

  async function goToOrder(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return;
    setLooking(true);
    setLookupError(null);
    try {
      const results = await api.get<ServiceOrderListItem[]>(
        `/service-orders?search=${encodeURIComponent(trimmed)}`
      );
      const match = results.find((o) => o.externalId.toLowerCase() === trimmed.toLowerCase()) ?? results[0];
      if (!match) {
        setLookupError(`Não foi encontrada nenhuma Ordem de Serviço com o código "${trimmed}".`);
        return;
      }
      await stopScanner();
      navigate(`/service-orders/${match.id}`);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Erro ao procurar a Ordem de Serviço.");
    } finally {
      setLooking(false);
    }
  }

  async function stopScanner() {
    const scanner = scannerRef.current;
    if (!scanner) return;
    try {
      await scanner.stop();
      await scanner.clear();
    } catch {
      // já estava parado — sem problema.
    }
    scannerRef.current = null;
    setScanning(false);
  }

  async function startScanner() {
    setCameraError(null);
    setLookupError(null);
    const scanner = new Html5Qrcode(READER_ELEMENT_ID, {
      formatsToSupport: [Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.QR_CODE],
      verbose: false,
    });
    scannerRef.current = scanner;
    try {
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 260, height: 140 } },
        (decodedText) => {
          // Evita disparar a mesma leitura várias vezes seguidas enquanto a
          // câmara continua a apontar para o mesmo código.
          if (!looking) goToOrder(decodedText);
        },
        () => {
          // erro de leitura de uma frame individual (código fora de foco,
          // etc.) — normal e frequente, ignora-se em silêncio.
        }
      );
      setScanning(true);
    } catch (err) {
      scannerRef.current = null;
      setCameraError(
        err instanceof Error
          ? `Não foi possível aceder à câmara: ${err.message}`
          : "Não foi possível aceder à câmara."
      );
    }
  }

  useEffect(() => {
    return () => {
      stopScanner();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    };
  }, []);

  async function handleManualSubmit(e: FormEvent) {
    e.preventDefault();
    await goToOrder(manualCode);
  }

  return (
    <div>
      <div className="page-header">
        <h2>Ler Código</h2>
      </div>

      <div className="card">
        <p className="muted" style={{ marginBottom: 16 }}>
          Aponta a câmara ao código de barras da etiqueta colada no produto para abrir diretamente a Ordem de
          Serviço.
        </p>

        {!scanning && (
          <button className="btn" onClick={startScanner} disabled={looking}>
            Ativar câmara
          </button>
        )}
        {scanning && (
          <button className="btn secondary" onClick={stopScanner} style={{ marginBottom: 12 }}>
            Parar câmara
          </button>
        )}

        <div
          id={READER_ELEMENT_ID}
          style={{
            marginTop: 12,
            maxWidth: 420,
            display: scanning ? "block" : "none",
          }}
        />

        {cameraError && <p className="error-text">{cameraError}</p>}
        {looking && <p className="muted">A procurar Ordem de Serviço...</p>}
        {lookupError && <p className="error-text">{lookupError}</p>}
      </div>

      <div className="card">
        <h4>Ou escreve o número da OS</h4>
        <form onSubmit={handleManualSubmit}>
          <div className="form-grid">
            <div>
              <label>Nº da Ordem de Serviço</label>
              <input
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="Ex.: 2026-1234"
                required
              />
            </div>
          </div>
          <button className="btn" type="submit" disabled={looking}>
            Abrir OS
          </button>
        </form>
      </div>
    </div>
  );
}
