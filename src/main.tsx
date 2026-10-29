import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Sem StrictMode: a montagem dupla em dev abriria e fecharia o canal Realtime e o microfone duas vezes.
createRoot(document.getElementById('root')!).render(<App />);
