export interface SecretStore {
  put(ref: string, value: string): void;
  get(ref: string): string | undefined;
  delete(ref: string): void;
  listRefs(): string[];
  has(ref: string): boolean;
}

export class InMemorySecretStore implements SecretStore {
  private readonly secrets = new Map<string, string>();

  put(ref: string, value: string): void {
    this.secrets.set(ref, value);
  }

  get(ref: string): string | undefined {
    return this.secrets.get(ref);
  }

  delete(ref: string): void {
    this.secrets.delete(ref);
  }

  listRefs(): string[] {
    return [...this.secrets.keys()];
  }

  has(ref: string): boolean {
    return this.secrets.has(ref);
  }

  clear(): void {
    this.secrets.clear();
  }
}
