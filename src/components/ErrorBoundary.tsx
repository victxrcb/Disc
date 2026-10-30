import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from './Icon';

interface Props {
  children: ReactNode;
  /** Texto curto do que falhou, ex.: "a conversa". */
  area?: string;
  /** Chamado quando a pessoa pede para tentar de novo. */
  onReset?(): void;
}

interface State {
  error: Error | null;
}

/** Impede que um erro de renderização apague a tela inteira; mostra um aviso com opção de recarregar. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[erro] Falha ao exibir ${this.props.area ?? 'a tela'}:`, error, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-panel" role="alert">
        <span className="error-panel__icon"><Icon name="alert" /></span>
        <strong>Não foi possível exibir {this.props.area ?? 'esta tela'}.</strong>
        <p>Algo deu errado aqui, mas o resto do app continua funcionando.</p>
        <div className="error-panel__actions">
          <button className="btn btn--primary btn--small" type="button" onClick={this.reset}>Tentar de novo</button>
          <button className="btn btn--small" type="button" onClick={() => window.location.reload()}>Recarregar o app</button>
        </div>
      </div>
    );
  }
}
