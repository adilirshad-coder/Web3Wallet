export interface EventStore {
  claim(eventId: string): Promise<boolean>;
  release(eventId: string): Promise<void>;
}

export class MemoryEventStore implements EventStore {
  private readonly ids = new Set<string>();
  async claim(eventId: string): Promise<boolean> {
    if (this.ids.has(eventId)) return false;
    this.ids.add(eventId);
    return true;
  }
  async release(eventId: string): Promise<void> { this.ids.delete(eventId); }
}
