/**
 * MSE Player — Media Source Extensions video player
 *
 * Receives fragmented MP4 (fMP4) binary data and feeds it into an HTML5 <video>
 * element via the Media Source Extensions API for real-time playback.
 *
 * fMP4 structure expected:
 * - First message: Init segment (ftyp + moov boxes)
 * - Subsequent messages: Media segments (moof + mdat boxes)
 *
 * The player operates in zero-buffer mode: each segment is appended immediately
 * and the video element plays as data arrives.
 */

class MSEPlayer {
    constructor(videoElement) {
        this.video = videoElement;
        this.mediaSource = null;
        this.sourceBuffer = null;
        this.queue = [];
        this.isAppending = false;
        this.isInitialized = false;
        this.codec = 'video/mp4; codecs="avc1.4d401f"'; // H.264 Main Profile Level 3.1

        // Bind methods
        this._onSourceOpen = this._onSourceOpen.bind(this);
        this._processQueue = this._processQueue.bind(this);
    }

    /**
     * Initialize the MSE pipeline. Must be called before feeding data.
     * @returns {Promise<boolean>} true if MSE is supported and initialized
     */
    init() {
        return new Promise((resolve) => {
            if (!('MediaSource' in window)) {
                console.error('[MSEPlayer] MediaSource API not supported');
                resolve(false);
                return;
            }

            if (!MediaSource.isTypeSupported(this.codec)) {
                console.error('[MSEPlayer] Codec not supported:', this.codec);
                resolve(false);
                return;
            }

            this.mediaSource = new MediaSource();
            this.video.src = URL.createObjectURL(this.mediaSource);

            this.mediaSource.addEventListener('sourceopen', () => {
                this._onSourceOpen();
                resolve(true);
            });

            this.mediaSource.addEventListener('sourceclose', () => {
                console.warn('[MSEPlayer] MediaSource closed');
            });

            this.mediaSource.addEventListener('sourceended', () => {
                console.warn('[MSEPlayer] MediaSource ended');
            });
        });
    }

    /**
     * Feed a binary segment (fMP4) to the player.
     * @param {ArrayBuffer} data - fMP4 segment data
     */
    feed(data) {
        if (!this.sourceBuffer) {
            console.warn('[MSEPlayer] SourceBuffer not ready, queuing data');
            this.queue.push(data);
            return;
        }

        this.queue.push(data);
        this._processQueue();
    }

    /**
     * Reset the player. Clears buffers and stops playback.
     */
    reset() {
        this.queue = [];
        this.isAppending = false;
        this.isInitialized = false;

        if (this.sourceBuffer) {
            try {
                this.sourceBuffer.abort();
            } catch (e) {
                // Ignore if source buffer is not in a valid state
            }
        }

        if (this.mediaSource && this.mediaSource.readyState === 'open') {
            try {
                this.mediaSource.endOfStream();
            } catch (e) {
                // Ignore
            }
        }

        this.video.src = '';
        this.mediaSource = null;
        this.sourceBuffer = null;
    }

    /**
     * @private
     * Called when MediaSource transitions to 'open' state.
     */
    _onSourceOpen() {
        console.log('[MSEPlayer] MediaSource opened, adding SourceBuffer');

        try {
            this.sourceBuffer = this.mediaSource.addSourceBuffer(this.codec);

            // Use 'sequence' mode for live streaming — timestamps are derived from
            // the order of appended segments rather than embedded timestamps
            this.sourceBuffer.mode = 'sequence';

            this.sourceBuffer.addEventListener('updateend', () => {
                this.isAppending = false;
                this._processQueue();
                this._trimBuffer();
            });

            this.sourceBuffer.addEventListener('error', (e) => {
                console.error('[MSEPlayer] SourceBuffer error:', e);
            });

            // Process any data that was queued before source was ready
            this._processQueue();
        } catch (e) {
            console.error('[MSEPlayer] Failed to add SourceBuffer:', e);
        }
    }

    /**
     * @private
     * Process queued segments sequentially (SourceBuffer requires serial appends).
     */
    _processQueue() {
        if (this.isAppending || this.queue.length === 0 || !this.sourceBuffer) {
            return;
        }

        if (this.mediaSource.readyState !== 'open') {
            console.warn('[MSEPlayer] MediaSource not open, skipping append');
            return;
        }

        this.isAppending = true;
        const data = this.queue.shift();

        try {
            this.sourceBuffer.appendBuffer(data);

            // Auto-play on first successful append
            if (!this.isInitialized) {
                this.isInitialized = true;
                this.video.play().catch(e => {
                    console.warn('[MSEPlayer] Auto-play blocked:', e.message);
                });
            }
        } catch (e) {
            console.error('[MSEPlayer] appendBuffer failed:', e);
            this.isAppending = false;

            // If QuotaExceededError, trim buffer and retry
            if (e.name === 'QuotaExceededError') {
                this._trimBuffer(true);
                this.queue.unshift(data);
                setTimeout(() => this._processQueue(), 100);
            }
        }
    }

    /**
     * @private
     * Trim old data from the source buffer to prevent memory issues.
     * Keeps only the last 2 seconds of data for ultra-low latency.
     */
    _trimBuffer(aggressive = false) {
        if (!this.sourceBuffer || this.sourceBuffer.updating) {
            return;
        }

        try {
            const buffered = this.sourceBuffer.buffered;
            if (buffered.length === 0) return;

            const currentTime = this.video.currentTime;
            const bufferStart = buffered.start(0);
            // Keep last 2s normally, or just 0.5s if aggressive
            const keepSeconds = aggressive ? 0.5 : 2.0;
            const removeEnd = currentTime - keepSeconds;

            if (removeEnd > bufferStart) {
                this.sourceBuffer.remove(bufferStart, removeEnd);
            }
        } catch (e) {
            // Ignore trim errors
        }
    }
}
