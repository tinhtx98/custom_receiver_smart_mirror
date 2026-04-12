/**
 * WebSocket Client — connects to the iPhone's WebSocket mirror server
 *
 * Handles connection lifecycle with automatic reconnection.
 * Receives binary fMP4 frames and forwards them to the MSE player.
 *
 * Protocol:
 * - First binary message: init segment (ftyp + moov)
 * - Subsequent binary messages: media segments (moof + mdat)
 * - Text messages: JSON control messages (e.g., {"type": "quality_change", ...})
 */

class WebSocketClient {
    /**
     * @param {Object} callbacks
     * @param {function(ArrayBuffer)} callbacks.onData - Called with binary fMP4 data
     * @param {function(string)} callbacks.onStatus - Called with status text updates
     * @param {function()} callbacks.onConnected - Called when WebSocket connects
     * @param {function(string)} callbacks.onError - Called with error description
     * @param {function(Object)} callbacks.onControl - Called with parsed JSON control message
     */
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.ws = null;
        this.url = null;
        this.reconnectTimer = null;
        this.reconnectAttempt = 0;
        this.maxReconnectAttempts = 20;
        this.baseReconnectDelay = 500; // ms
        this.maxReconnectDelay = 5000; // ms
        this.isManualClose = false;
    }

    /**
     * Connect to the WebSocket mirror server.
     * @param {string} url - WebSocket URL (e.g., ws://192.168.1.x:8082/mirror)
     */
    connect(url) {
        this.url = url;
        this.isManualClose = false;
        this.reconnectAttempt = 0;
        this._connect();
    }

    /**
     * Disconnect from the server. Stops reconnection attempts.
     */
    disconnect() {
        this.isManualClose = true;
        this._clearReconnect();

        if (this.ws) {
            this.ws.close(1000, 'Client disconnect');
            this.ws = null;
        }
    }

    /**
     * @private
     * Establish the WebSocket connection.
     */
    _connect() {
        if (this.ws) {
            try { this.ws.close(); } catch (e) { /* ignore */ }
        }

        this.callbacks.onStatus('Connecting to mirror server...');
        console.log('[WebSocketClient] Connecting to', this.url);

        try {
            this.ws = new WebSocket(this.url);
            this.ws.binaryType = 'arraybuffer';

            this.ws.onopen = () => {
                console.log('[WebSocketClient] Connected');
                this.reconnectAttempt = 0;
                this.callbacks.onConnected();
                this.callbacks.onStatus('Connected — waiting for video data...');
            };

            this.ws.onmessage = (event) => {
                if (event.data instanceof ArrayBuffer) {
                    // Binary frame: fMP4 segment data
                    this.callbacks.onData(event.data);
                } else if (typeof event.data === 'string') {
                    // Text frame: JSON control message
                    try {
                        const msg = JSON.parse(event.data);
                        console.log('[WebSocketClient] Control message:', msg);
                        this.callbacks.onControl(msg);
                    } catch (e) {
                        console.warn('[WebSocketClient] Invalid text message:', event.data);
                    }
                }
            };

            this.ws.onclose = (event) => {
                console.log('[WebSocketClient] Closed, code:', event.code, 'reason:', event.reason);

                if (!this.isManualClose) {
                    this.callbacks.onError('Connection lost');
                    this._scheduleReconnect();
                }
            };

            this.ws.onerror = (error) => {
                console.error('[WebSocketClient] Error:', error);
                // onclose will fire after onerror, so reconnect is handled there
            };
        } catch (e) {
            console.error('[WebSocketClient] Failed to create WebSocket:', e);
            this.callbacks.onError('Failed to connect');
            this._scheduleReconnect();
        }
    }

    /**
     * @private
     * Schedule a reconnection attempt with exponential backoff.
     */
    _scheduleReconnect() {
        if (this.isManualClose) return;
        if (this.reconnectAttempt >= this.maxReconnectAttempts) {
            console.error('[WebSocketClient] Max reconnect attempts reached');
            this.callbacks.onError('Unable to reconnect after ' + this.maxReconnectAttempts + ' attempts');
            return;
        }

        this.reconnectAttempt++;
        const delay = Math.min(
            this.baseReconnectDelay * Math.pow(1.5, this.reconnectAttempt - 1),
            this.maxReconnectDelay
        );

        console.log('[WebSocketClient] Reconnecting in', delay, 'ms (attempt', this.reconnectAttempt, ')');
        this.callbacks.onStatus('Reconnecting... (attempt ' + this.reconnectAttempt + ')');

        this.reconnectTimer = setTimeout(() => {
            this._connect();
        }, delay);
    }

    /**
     * @private
     * Clear any pending reconnection timer.
     */
    _clearReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
}
