/**
 * Lightweight Domain Event Bus
 * Enables decoupled communication between modules (e.g., triggering a notification 
 * or invalidating a dashboard widget when a payment is approved).
 */

type EventCallback<T = any> = (payload: T) => void;

class EventBus {
  private listeners: Record<string, EventCallback[]> = {};

  on<T>(event: string, callback: EventCallback<T>) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
    return () => this.off(event, callback); // Return unsubscribe function
  }

  off<T>(event: string, callback: EventCallback<T>) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }

  emit<T>(event: string, payload?: T) {
    if (!this.listeners[event]) return;
    this.listeners[event].forEach(callback => {
      try { callback(payload); } 
      catch (err) { console.error(`Error in domain event [${event}]:`, err); }
    });
  }
}

export const domainEvents = new EventBus();

export const EVENTS = {
  PAYMENT_APPROVED: "PAYMENT_APPROVED",
  PO_CREATED: "PO_CREATED",
  WORKORDER_COMPLETED: "WORKORDER_COMPLETED",
} as const;