import type { EventName, EventPayload } from '@sevenvid/ipc';

type Handler<E extends EventName> = (payload: EventPayload<E>) => void;
type AnyHandler = (event: EventName, payload: unknown) => void;

/** Typed publish/subscribe bus for engine → UI events. Handlers never throw into the emitter. */
export class EventBus {
  private readonly handlers = new Map<EventName, Set<Handler<EventName>>>();
  private readonly anyHandlers = new Set<AnyHandler>();

  emit<E extends EventName>(event: E, payload: EventPayload<E>): void {
    for (const h of this.handlers.get(event) ?? []) {
      try {
        (h as Handler<E>)(payload);
      } catch {
        /* isolated */
      }
    }
    for (const h of this.anyHandlers) {
      try {
        h(event, payload);
      } catch {
        /* isolated */
      }
    }
  }

  on<E extends EventName>(event: E, handler: Handler<E>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<EventName>);
    return () => set!.delete(handler as Handler<EventName>);
  }

  onAny(handler: AnyHandler): () => void {
    this.anyHandlers.add(handler);
    return () => this.anyHandlers.delete(handler);
  }
}
