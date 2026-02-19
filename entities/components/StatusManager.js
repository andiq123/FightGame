/**
 * StatusManager handles all 'until' timers and transient states for an entity.
 */
export class StatusManager {
    constructor() {
        this.statuses = new Map();
    }

    set(name, until) {
        this.statuses.set(name, until);
    }

    get(name) {
        return this.statuses.get(name) || 0;
    }

    active(name, now) {
        return this.get(name) > now;
    }

    clear(name) {
        this.statuses.delete(name);
    }

    /**
     * Returns an array of keys that are currently active.
     */
    activeKeys(now) {
        const keys = [];
        for (const [name, until] of this.statuses.entries()) {
            if (until > now) keys.push(name);
        }
        return keys;
    }

    /**
     * Helper to check multiple conditions (OR)
     */
    anyActive(names, now) {
        return names.some(name => this.active(name, now));
    }
}
