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
//
// Nota importante sobre a ordem de arranque: o elemento onde a biblioteca
// desenha o vídeo da câmara TEM de já estar visível (com dimensões reais)
// no ecrã antes de se chamar scanner.start() — se estiver escondido
// (display:none / tamanho zero) nesse momento, a câmara não arranca e não
// aparece imagem nenhuma, mesmo sem erro visível. Por isso o arranque só
// acontece num useEffect que corre DEPOIS do React já ter tornado o
// contentor visível (a seguir a "wantsCamera" passar a true), nunca no
// próprio clique do botão.
// ============================================================================

const READER_ELEMENT_ID = "barcode-scanner-viewport";

export function ScanPage() {
  const navigate = useNavigate();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  // "Pedido" do utilizador (torna o contentor visível) vs. "scanning"
  // (câmara já efetivamente a correr) — propositadamente dois estados
  // separados, para garantir a ordem correta descrita acima.
  const [wantsCamera, setWantsCamera] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const lookingRef = useRef(looking);
  lookingRef.current = looking;

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
      setWantsCamera(false);
      navigate(`/service-orders/${match.id}`);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Erro ao procurar a Ordem de Serviço.");
    } finally {
      setLooking(false);
    }
  }

  // Só pede para o contentor ficar visível — o arranque real da câmara
  // acontece no useEffect abaixo, depois de o React já ter pintado o
  // contentor no ecrã.
  function requestCamera() {
    setCameraError(null);
    setLookupError(null);
    setWantsCamera(true);
  }

  function stopCamera() {
    setWantsCamera(false);
  }

  useEffect(() => {
    if (!wantsCamera) {
      const scanner = scannerRef.current;
      if (scanner) {
        scanner
          .stop()
          .catch(() => {})
          .finally(() => {
            try {
              scanner.clear();
            } catch {
              // ignora — contentor pode já ter sido desmontado
            }
          });
        scannerRef.current = null;
      }
      setScanning(false);
      return;
    }

    let cancelled = false;
    const scanner = new Html5Qrcode(READER_ELEMENT_ID, {
      formatsToSupport: [Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.QR_CODE],
      verbose: false,
    });
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 130 } },
        (decodedText) => {
          // Evita disparar a mesma leitura várias vezes seguidas enquanto a
          // câmara continua a apontar para o mesmo código.
          if (!lookingRef.current) goToOrder(decodedText);
        },
        () => {
          // erro de leitura de uma frame individual (código fora de foco,
          // etc.) — normal e frequente, ignora-se em silêncio.
        }
      )
      .then(() => {
        if (!cancelled) setScanning(true);
      })
      .catch((err) => {
        if (cancelled) return;
        scannerRef.current = null;
        setWantsCamera(false);
        const message = err instanceof Error ? err.message : String(err);
        if (/NotAllowedError|Permission/i.test(message)) {
          setCameraError(
            "Sem permissão para usar a câmara. Verifica as permissões do browser/site e tenta novamente."
          );
        } else if (/NotFoundError|no camera|não.*câmara/i.test(message)) {
          setCameraError("Não foi encontrada nenhuma câmara neste dispositivo.");
        } else {
          setCameraError(`Não foi possível aceder à câmara: ${message}`);
        }
      });

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s) {
        s.stop()
          .catch(() => {})
          .finally(() => {
            try {
              s.clear();
            } catch {
              // ignora — contentor pode já ter sido desmontado
            }
          });
        scannerRef.current = null;
      }
      setScanning(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsCamera]);

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

        {!wantsCamera && (
          <button className="btn" onClick={requestCamera} disabled={looking}>
            Ativar câmara
          </button>
        )}
        {wantsCamera && (
          <button className="btn secondary" onClick={stopCamera} style={{ marginBottom: 12 }}>
            Parar câmara
          </button>
        )}

        {/* O contentor fica sempre no DOM (nunca é desmontado condicionalmente)
            para que o elemento exista quando se cria o Html5Qrcode, mas só
            ganha altura real quando "wantsCamera" é true — é essa mudança de
            tamanho, já pintada pelo React, que o useEffect acima espera antes
            de arrancar a câmara. */}
        <div
          id={READER_ELEMENT_ID}
          style={{
            marginTop: wantsCamera ? 12 : 0,
            maxWidth: 420,
            minHeight: wantsCamera ? 260 : 0,
            overflow: "hidden",
          }}
        />

        {wantsCamera && !scanning && !cameraError && (
          <p className="muted">A pedir acesso à câmara — aceita o pedido de permissão do browser...</p>
        )}
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
