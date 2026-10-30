import { useEffect, useState } from 'react';
import { Icon } from './Icon';

type UpdateState = 'idle' | 'downloading' | 'ready' | 'installing' | 'error';

interface UpdateStatus {
  state: UpdateState;
  version?: string;
  percent?: number;
  bytesPerSecond?: number;
}

declare global {
  interface Window {
    desktopUpdates?: {
      getStatus(): Promise<UpdateStatus>;
      install(): Promise<boolean>;
      onStatus(callback: (status: UpdateStatus) => void): () => void;
    };
  }
}

function formatSpeed(bytesPerSecond?: number): string {
  if (!bytesPerSecond) return '';
  const mb = bytesPerSecond / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${Math.max(1, Math.round(bytesPerSecond / 1024))} KB/s`;
}

/** Avisos de atualização do app desktop: cartão discreto durante o download e tela cheia ao instalar. */
export function UpdateCenter() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    const bridge = window.desktopUpdates;
    if (!bridge) return;
    void bridge.getStatus().then(setStatus).catch(() => undefined);
    return bridge.onStatus(setStatus);
  }, []);

  if (status.state === 'idle') return null;

  if (status.state === 'installing') {
    return (
      <div className="update-screen" role="alertdialog" aria-live="assertive" aria-label="Instalando atualização">
        <div className="update-screen__art" aria-hidden="true" />
        <p className="home__wordmark update-screen__wordmark">Discord<br />2.0</p>
        <div className="update-screen__panel">
          <div className="download-card__eyebrow"><span className="download-card__dot" /> Atualizando</div>
          <h1>Instalando a versão {status.version}.</h1>
          <p>O aplicativo vai fechar e abrir de novo sozinho em alguns segundos.</p>
          <div className="update-progress update-progress--indeterminate"><span /></div>
        </div>
      </div>
    );
  }

  const key = `${status.state}:${status.version ?? ''}`;
  if (dismissed === key) return null;
  const percent = Math.min(100, Math.max(0, status.percent ?? 0));

  return (
    <aside className={`update-toast update-toast--${status.state}`} role="status" aria-live="polite">
      <div className="update-toast__head">
        <span className="update-toast__icon"><Icon name={status.state === 'error' ? 'alert' : status.state === 'ready' ? 'check' : 'download'} size={16} /></span>
        <div>
          <strong>
            {status.state === 'downloading' && 'Baixando atualização'}
            {status.state === 'ready' && 'Atualização pronta'}
            {status.state === 'error' && 'Não foi possível atualizar'}
          </strong>
          <span>
            {status.state === 'downloading' && `Versão ${status.version} · ${percent}%${status.bytesPerSecond ? ` · ${formatSpeed(status.bytesPerSecond)}` : ''}`}
            {status.state === 'ready' && `A versão ${status.version} já foi baixada.`}
            {status.state === 'error' && 'Vamos tentar de novo na próxima vez que você abrir o app.'}
          </span>
        </div>
        {status.state !== 'downloading' && (
          <button className="icon-btn update-toast__close" type="button" onClick={() => setDismissed(key)} aria-label="Fechar aviso" title={status.state === 'ready' ? 'Instalar quando fechar o app' : 'Fechar'}>
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      {status.state === 'downloading' && <div className="update-progress"><span style={{ width: `${percent}%` }} /></div>}
      {status.state === 'ready' && (
        <div className="update-toast__actions">
          <button className="btn btn--primary btn--small" type="button" onClick={() => void window.desktopUpdates?.install()}>Reiniciar e atualizar</button>
          <button className="btn btn--small" type="button" onClick={() => setDismissed(key)}>Depois</button>
        </div>
      )}
      {status.state === 'ready' && <small className="update-toast__hint">Se escolher depois, instalamos quando você fechar o app.</small>}
    </aside>
  );
}
