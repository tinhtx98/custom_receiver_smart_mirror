/**
 * Cast Receiver — Google Cast Application Framework (CAF) integration
 *
 * Manages the Cast session lifecycle and custom messaging channel
 * to receive the WebSocket URL from the iOS sender app.
 *
 * Custom channel namespace: urn:x-cast:com.smartmirror.mirror
 * Expected message from sender: { "type": "connect", "wsUrl": "ws://..." }
 */

class CastReceiver {
    /**
     * @param {Object} callbacks
     * @param {function(string)} callbacks.onMirrorConnect - Called with wsUrl to connect
     * @param {function()} callbacks.onMirrorStop - Called when sender requests stop
     * @param {function(string)} callbacks.onStatus - Status text updates
     */
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.context = null;
        this.namespace = 'urn:x-cast:com.smartmirror.mirror';
    }

    /**
     * Initialize the CAF Receiver. Must be called once on page load.
     */
    init() {
        const castContext = cast.framework.CastReceiverContext.getInstance();
        this.context = castContext;

        // Set up custom message listener for our namespace
        castContext.addCustomMessageListener(this.namespace, (event) => {
            console.log('[CastReceiver] Custom message received:', event.data);
            this._handleCustomMessage(event.data, event.senderId);
        });

        // Log lifecycle events
        castContext.addEventListener(
            cast.framework.system.EventType.READY,
            () => {
                console.log('[CastReceiver] Receiver ready');
                this.callbacks.onStatus('Receiver ready — waiting for sender...');
            }
        );

        castContext.addEventListener(
            cast.framework.system.EventType.SENDER_CONNECTED,
            (event) => {
                console.log('[CastReceiver] Sender connected:', event.senderId);
                this.callbacks.onStatus('Sender connected — waiting for mirror config...');
            }
        );

        castContext.addEventListener(
            cast.framework.system.EventType.SENDER_DISCONNECTED,
            (event) => {
                console.log('[CastReceiver] Sender disconnected:', event.senderId);
                // If no senders remain, stop mirroring
                if (castContext.getSenders().length === 0) {
                    console.log('[CastReceiver] No senders remaining, stopping');
                    this.callbacks.onMirrorStop();
                }
            }
        );

        // Start the receiver (this makes the receiver "active" to Cast senders)
        const options = new cast.framework.CastReceiverOptions();
        options.disableIdleTimeout = true; // Keep the receiver alive during mirroring
        options.maxInactivity = 3600;      // 1 hour max inactivity before auto-close

        castContext.start(options);
        console.log('[CastReceiver] CAF Receiver started');
    }

    /**
     * Send a message back to the sender app (e.g., status updates).
     * @param {string} senderId - The sender to message
     * @param {Object} message - JSON message to send
     */
    sendToSender(senderId, message) {
        if (this.context) {
            this.context.sendCustomMessage(this.namespace, senderId, message);
        }
    }

    /**
     * Send a message to all connected senders.
     * @param {Object} message - JSON message to broadcast
     */
    broadcastToSenders(message) {
        if (!this.context) return;
        const senders = this.context.getSenders();
        senders.forEach(sender => {
            this.sendToSender(sender.id, message);
        });
    }

    /**
     * @private
     * Handle incoming custom channel messages from the sender.
     */
    _handleCustomMessage(data, senderId) {
        // data can be a string or object depending on how sender sends it
        let message = data;
        if (typeof data === 'string') {
            try {
                message = JSON.parse(data);
            } catch (e) {
                console.warn('[CastReceiver] Failed to parse message:', data);
                return;
            }
        }

        switch (message.type) {
            case 'connect':
                // Sender provides the WebSocket URL to connect to
                if (message.wsUrl) {
                    console.log('[CastReceiver] Mirror connect requested:', message.wsUrl);
                    this.callbacks.onMirrorConnect(message.wsUrl);
                    // Acknowledge to sender
                    this.sendToSender(senderId, {
                        type: 'ack',
                        status: 'connecting',
                        wsUrl: message.wsUrl
                    });
                }
                break;

            case 'stop':
                console.log('[CastReceiver] Mirror stop requested');
                this.callbacks.onMirrorStop();
                this.sendToSender(senderId, { type: 'ack', status: 'stopped' });
                break;

            case 'quality_change':
                console.log('[CastReceiver] Quality change:', message.quality);
                // The sender will restart the stream; receiver just needs to reset MSE
                this.callbacks.onMirrorStop();
                break;

            default:
                console.warn('[CastReceiver] Unknown message type:', message.type);
        }
    }
}
