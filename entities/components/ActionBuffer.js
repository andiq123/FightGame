/**
 * ActionBuffer handles input queuing for smoother gameplay.
 */
export class ActionBuffer {
    constructor(windowMs = 250) {
        this.windowMs = windowMs;
        this.clear();
    }

    set(type, data, now) {
        this.type = type;
        this.data = data;
        this.at = now;
    }

    get(now) {
        if (this.type && now - this.at < this.windowMs) {
            return { type: this.type, data: this.data };
        }
        return null;
    }

    clear() {
        this.type = null;
        this.data = null;
        this.at = 0;
    }
}
