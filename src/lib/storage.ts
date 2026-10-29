// localStorage pode lançar exceção (modo privado, bloqueado); nunca deixa isso quebrar a página.
export function loadString(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

export function saveString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignorado */
  }
}
