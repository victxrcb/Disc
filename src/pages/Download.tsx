import { lazy, Suspense, useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { isValidRoomCode, normalizeRoomCode } from '../lib/roomCode';

const HomeScene = lazy(() => import('../components/HomeScene').catch(() => ({ default: () => null })));
const DOWNLOAD_URL = 'https://github.com/victxrcb/Disc/releases/latest/download/Discord-2.0-Windows.exe';
const RELEASES_URL = 'https://github.com/victxrcb/Disc/releases';

function roomCodeFromPath(): string {
  const code = normalizeRoomCode(window.location.pathname.slice(1));
  return isValidRoomCode(code) ? code : '';
}

export function Download() {
  const roomCode = roomCodeFromPath();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = roomCode ? `Convite ${roomCode} — Discord 2.0` : 'Discord 2.0 para Windows';
  }, [roomCode]);

  const copyCode = () => {
    if (!roomCode) return;
    void navigator.clipboard.writeText(roomCode).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <main className="home download-page">
      <Suspense fallback={null}><HomeScene /></Suspense>
      <p className="home__wordmark">Discord<br />2.0</p>

      <section className="home__card download-card">
        <div className="download-card__eyebrow">
          <span className="download-card__dot" /> Aplicativo para Windows
        </div>

        {roomCode ? (
          <>
            <h1 className="home__title">Você recebeu um convite.</h1>
            <p className="home__lead">Baixe o aplicativo e entre usando o código da sala abaixo.</p>
            <button className="download-code" type="button" onClick={copyCode} title="Copiar código da sala">
              <span><small>Código da sala</small>{roomCode}</span>
              <Icon name={copied ? 'check' : 'copy'} size={20} />
            </button>
          </>
        ) : (
          <>
            <h1 className="home__title">Sua resenha merece um lugar próprio.</h1>
            <p className="home__lead">
              Voz, câmera, compartilhamento de tela, música e chat em um aplicativo feito para ficar aberto com a galera.
            </p>
          </>
        )}

        <a className="btn btn--primary btn--block download-card__button" href={DOWNLOAD_URL}>
          <Icon name="download" size={20} />
          Baixar para Windows
        </a>
        <p className="download-card__meta">Windows 10/11 · 64 bits · Versão 0.4.2</p>

        <div className="download-features" aria-label="Recursos do aplicativo">
          <span><Icon name="users" size={16} /> Perfis e amigos</span>
          <span><Icon name="camera" size={16} /> Câmera e tela</span>
          <span><Icon name="chat" size={16} /> Chat e convites</span>
        </div>

        <a className="download-card__releases" href={RELEASES_URL}>
          Ver todas as versões no GitHub
        </a>
      </section>
    </main>
  );
}
