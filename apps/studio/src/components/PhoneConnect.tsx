import { remoteAvailable, useRemote } from "../capture/remote";
import { useCamera } from "../state/camera";

/** QR code and connected phones. Phones in live mode can be picked as the camera. */
export function PhoneConnect() {
  const { server, devices, starting, error, start, stop } = useRemote();
  const sourceId = useCamera((s) => s.source?.id);

  if (!remoteAvailable) {
    return <p className="hint">Conectar celulares está disponible en la app de escritorio.</p>;
  }
  if (!server) {
    return (
      <div className="phone-connect">
        <p className="hint">Usá el celular como cámara: con vista en vivo, papel de cebolla y disparo desde acá.</p>
        <button className="btn primary" onClick={() => void start()} disabled={starting}>
          {starting ? "Preparando…" : "Mostrar código QR"}
        </button>
        {error && <p className="panel-error">{error}</p>}
      </div>
    );
  }
  return (
    <div className="phone-connect">
      <img className="qr" src={server.qrDataUrl} alt="Código QR para conectar el celular" />
      <p className="hint">
        Escaneá el código con la cámara del celular. Tiene que estar en la <strong>misma red WiFi</strong> que esta computadora.
      </p>
      <details className="hint">
        <summary>¿No abre?</summary>
        <p>
          Escribí esta dirección en el navegador del celular:
          <br />
          <code className="selectable">{server.httpUrl}</code>
        </p>
        {server.addresses.length > 1 && <p>Otras redes de esta computadora: {server.addresses.slice(1).join(", ")}</p>}
      </details>
      {devices.length > 0 && (
        <ul className="devices">
          {devices.map((d) => {
            const id = `phone:${d.sessionId}`;
            return (
              <li key={d.sessionId}>
                <span>
                  📱 {d.device} <small>{d.mode === "live" ? "en vivo" : "manda fotos"}</small>
                </span>
                {d.mode === "live" &&
                  (sourceId === id ? (
                    <small className="in-use">En uso</small>
                  ) : (
                    <button className="btn small" onClick={() => void useCamera.getState().select(id)}>
                      Usar
                    </button>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
      <button className="btn ghost small" onClick={() => void stop()}>
        Dejar de aceptar celulares
      </button>
    </div>
  );
}
