/**
 * App — Main orchestration for Smart Mirror Custom Receiver
 *
 * Wires together CastReceiver, WebSocketClient, and MSEPlayer.
 *
 * Flow:
 * 1. CastReceiver initializes → waits for sender to connect
 * 2. Sender sends { type: "connect", wsUrl: "ws://..." } via custom channel
 * 3. WebSocketClient connects to the iPhone's WebSocket mirror server
 * 4. iPhone sends fMP4 init segment → then streaming media segments
 * 5. MSEPlayer renders video frames in real-time
 */

(function () {
    'use strict';

    const videoEl = document.getElementById('mirror-video');
    const splashEl = document.getElementById('splash');
    const statusTextEl = document.getElementById('status-text');
    const errorOverlayEl = document.getElementById('error-overlay');
    const errorTextEl = document.getElementById('error-text');
    const errorSubEl = document.getElementById('error-sub');

    let msePlayer = null;
    let wsClient = null;
    let castReceiver = null;
    let isMirroring = false;

    // ============================
    // UI Helpers
    // ============================

    function showSplash(statusText) {
        splashEl.classList.remove('hidden');
        errorOverlayEl.classList.add('hidden');
        if (statusText) statusTextEl.textContent = statusText;
    }

    function hideSplash() {
        splashEl.classList.add('hidden');
    }

    function showError(title, subtitle) {
        errorOverlayEl.classList.remove('hidden');
        errorTextEl.textContent = title || 'Error';
        errorSubEl.textContent = subtitle || '';
    }

    function hideError() {
        errorOverlayEl.classList.add('hidden');
    }

    // ============================
    // Mirror Lifecycle
    // ============================

    async function startMirroring(wsUrl) {
        console.log('[App] Starting mirror session, wsUrl:', wsUrl);

        // Reset previous session if any
        stopMirroring();

        isMirroring = true;

        // Initialize MSE Player
        msePlayer = new MSEPlayer(videoEl);
        const mseReady = await msePlayer.init();
        if (!mseReady) {
            showError('Playback Error', 'Media Source Extensions not supported on this device');
            return;
        }

        // Connect WebSocket
        wsClient = new WebSocketClient({
            onData: (data) => {
                // Feed binary fMP4 data to MSE player
                msePlayer.feed(data);
            },
            onStatus: (status) => {
                statusTextEl.textContent = status;
            },
            onConnected: () => {
                console.log('[App] WebSocket connected, hiding splash');
                hideError();
                // Splash hides after first video data arrives (below)
            },
            onError: (error) => {
                console.error('[App] WebSocket error:', error);
                if (isMirroring) {
                    showError('Connection Lost', 'Attempting to reconnect...');
                }
            },
            onControl: (msg) => {
                handleControlMessage(msg);
            }
        });

        wsClient.connect(wsUrl);

        // Hide splash once video starts playing
        videoEl.addEventListener('playing', function onPlaying() {
            videoEl.removeEventListener('playing', onPlaying);
            hideSplash();
            hideError();
            console.log('[App] Video playing — splash hidden');
        });

        showSplash('Connecting to mirror server...');
    }

    function stopMirroring() {
        console.log('[App] Stopping mirror session');
        isMirroring = false;

        if (wsClient) {
            wsClient.disconnect();
            wsClient = null;
        }

        if (msePlayer) {
            msePlayer.reset();
            msePlayer = null;
        }

        showSplash('Mirror session ended');
    }

    function handleControlMessage(msg) {
        switch (msg.type) {
            case 'quality_change':
                // Sender is changing quality; we need to reset MSE
                console.log('[App] Quality change, resetting MSE player');
                if (msePlayer) {
                    msePlayer.reset();
                }
                break;

            case 'ping':
                // Respond with pong for keep-alive
                if (castReceiver) {
                    castReceiver.broadcastToSenders({ type: 'pong' });
                }
                break;

            default:
                console.log('[App] Unhandled control message:', msg);
        }
    }

    // ============================
    // Initialize Cast Receiver
    // ============================

    function initCastReceiver() {
        castReceiver = new CastReceiver({
            onMirrorConnect: (wsUrl) => {
                startMirroring(wsUrl);
            },
            onMirrorStop: () => {
                stopMirroring();
            },
            onStatus: (status) => {
                statusTextEl.textContent = status;
            }
        });

        castReceiver.init();
    }

    // ============================
    // Boot
    // ============================

    showSplash('Initializing receiver...');

    // Wait for Cast SDK to load, then initialize
    window['__onGCastApiAvailable'] = function (isAvailable) {
        if (isAvailable) {
            console.log('[App] Cast SDK available, initializing');
            initCastReceiver();
        } else {
            console.error('[App] Cast SDK not available');
            showError('Cast SDK Error', 'Google Cast SDK failed to load');
        }
    };

    // Fallback: if Cast SDK is already loaded (unlikely but safe)
    if (window.cast && window.cast.framework) {
        console.log('[App] Cast SDK already loaded');
        initCastReceiver();
    }
})();
