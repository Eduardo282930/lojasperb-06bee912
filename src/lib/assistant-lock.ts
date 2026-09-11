export class AssistantBusyError extends Error {
  constructor() {
    super('Outra operação do Assistente ainda está em andamento. Aguarde um pouco e tente novamente; nada foi reenviado.');
    this.name = 'AssistantBusyError';
  }
}

// Retry only acquisition, never the operation itself (which may change stock).
export async function withAssistantLock<T>(
  acquire: () => Promise<boolean>,
  release: () => Promise<void>,
  operation: () => Promise<T>,
  wait: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 500)),
): Promise<T> {
  for (let attempt = 0; attempt < 11; attempt++) {
    if (await acquire()) {
      try { return await operation(); }
      finally { await release(); }
    }
    if (attempt < 10) await wait();
  }
  throw new AssistantBusyError();
}