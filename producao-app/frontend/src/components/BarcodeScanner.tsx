import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

// ============================================================================
// Leitor de código de barras/QR pela câmara, reutilizável (usado no Pó em
// Stock). Segue a mesma ordem de arranque da página "Ler Código" (ver nota em
// ScanPage.tsx): o contentor do vídeo tem de já estar visível no ecrã antes
// de se chamar scanner.start(), por isso este componente só é montado quando
// se quer mesmo a câmara, e o arranque acontece num useEffect, depois de o
// React já ter pintado o contentor.
// ============================================================================

let scannerSeq = 0;

export function BarcodeScanner({
  onDetected,
  onClose,
}: {
  onDetected: (code: string) => void;
  onClose: () => void;
}) {
  const [elementId] = useState(() => `barcode-scanner-${++scannerSeq}`);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const firedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const scanner = new Html5Qrcode(elementId, {
      formatsToSupport: [Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.QR_CODE],
      verbose: false,
    });

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 150 } },
        (decodedText) => {
          // Só a primeira leitura conta — a câmara continua a ver o mesmo
          // código várias vezes por segundo.
          if (firedRef.current) return;
          firedRef.current = true;
          onDetectedRef.current(decodedText.trim());
        },
        () => {
          // frame sem código legível — normal, ignora-se.
        }
      )
      .then(() => {
        if (!cancelled) setScanning(true);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        if (/NotAllowedError|Permission/i.test(message)) {
          setError("Sem permissão para usar a câmara. Verifica as permissões do browser/site e tenta novamente.");
        } else if (/NotFoundError|no camera/i.test(message)) {
          setError("Não foi encontrada nenhuma câmara neste dispositivo.");
        } else {
          setError(`Não foi possível aceder à câmara: ${message}`);
        }
      });

    return () => {
      cancelled = true;
      scanner
        .stop()
        .catch(() => {})
        .finally(() => {
          try {
            scanner.clear();
          } catch {
            // contentor já desmontado
          }
        });
    };
  }, [elementId]);

  return (
    <div>
      <button className="btn secondary" type="button" onClick={onClose} style={{ marginBottom: 12 }}>
        Parar câmara
      </button>
      <div id={elementId} style={{ maxWidth: 420, minHeight: 260, overflow: "hidden" }} />
      {!scanning && !error && <p className="muted">A pedir acesso à câmara — aceita o pedido do browser...</p>}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
