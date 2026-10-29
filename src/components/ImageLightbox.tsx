import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

const EXIT_MS = 180;

interface Props {
  src: string;
  alt: string;
  onClose(): void;
}

/** Visualização da imagem do chat em tela cheia. Fecha com Esc, clique fora ou no ×. */
export function ImageLightbox({ src, alt, onClose }: Props) {
  const [closing, setClosing] = useState(false);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const closingRef = useRef(false);

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(onClose, EXIT_MS);
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); // não fecha também a gaveta do chat
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, []);

  const ext = src.slice('data:image/'.length, src.indexOf(';')).replace('jpeg', 'jpg');

  return createPortal(
    <div
      className={`lightbox${closing ? ' lightbox--closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={close}
    >
      <div className="lightbox__bar" onClick={(e) => e.stopPropagation()}>
        <a className="icon-btn" href={src} download={`imagem-chat.${ext}`} title="Baixar" aria-label="Baixar imagem">
          <Icon name="download" />
        </a>
        <button ref={closeBtn} type="button" className="icon-btn" onClick={close} title="Fechar (Esc)" aria-label="Fechar">
          <Icon name="close" />
        </button>
      </div>
      <img className="lightbox__img" src={src} alt={alt} onClick={(e) => e.stopPropagation()} />
    </div>,
    document.body,
  );
}
