import { type CSSProperties, type ReactNode } from 'react';

/** Estrelas cintilantes sobre o céu da paisagem; posições fixas (sem aleatório no render). */
const STARS = Array.from({ length: 28 }, (_, i) => ({
  x: (i * 0.618034 * 100) % 100,
  y: ((i * 0.381966 * 7) % 1) * 55,
  size: 1.5 + (i % 3) * 0.8,
  delay: (i * 0.37) % 6,
  duration: 3 + (i % 4),
}));

/** Fundo decorativo da tela inicial: paisagem com estrelas cintilando. */
export default function HomeScene(): ReactNode {
  return (
    <div className="home__scene home__scene--landscape" aria-hidden="true">
      <img
        className="home__landscape"
        src="/images/castelo-panoramico-v2.webp"
        width={1672}
        height={941}
        alt=""
        fetchPriority="high"
        decoding="async"
        draggable={false}
      />
      <div className="home__stars">
        {STARS.map((s, i) => (
          <i
            key={i}
            style={
              {
                '--x': `${s.x}%`,
                '--y': `${s.y}%`,
                '--size': `${s.size}px`,
                '--delay': `${s.delay}s`,
                '--dur': `${s.duration}s`,
              } as CSSProperties
            }
          />
        ))}
      </div>
    </div>
  );
}
