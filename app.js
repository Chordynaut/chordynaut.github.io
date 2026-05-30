const { useState, useEffect, useRef, useCallback, useMemo } = React;

function SolanaMark({ className = '' } = {}) {
    return React.createElement('span', {
        className: `solana-mark ${className}`.trim(),
        role: 'img',
        'aria-label': 'Solana logo',
        title: 'Solana integration track'
    },
        React.createElement('span', null),
        React.createElement('span', null),
        React.createElement('span', null)
    );
}

const CHORDYNAUT_SIGNED_BUNDLE_SCHEMA = 'chordynaut.signed_bundle.v1';
const CHORDYNAUT_APP_VERSION = '2026-05-30-pages-v4';
const CHORDYNAUT_TUTORIAL_SEEN_KEY = 'chordynaut.tutorialSeen.v1';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const CHORDYNAUT_TUTORIAL_STEPS = [
    {
        anchor: 'wallet',
        title: '1. Connect your Solana wallet',
        body: 'Use the wallet button in the top bar. Chordynaut uses your wallet to sign the finished bundle; it does not write anything onchain.'
    },
    {
        anchor: 'strum',
        title: '2. Play the instrument',
        body: 'Tap a chord on the left, then strum the large pad. Your notes, timing, mode, tempo, and settings become the performance data.'
    },
    {
        anchor: 'record',
        title: '3. Record something',
        body: 'Press the red record button, play a short piece, then press record again to stop. You can also use the loop controls if you prefer.'
    },
    {
        anchor: 'download',
        title: '4. Sign and save',
        body: 'Open the download panel, choose sign bundle, approve the wallet signature, and save the zip with audio, performance data, and receipt.'
    },
    {
        anchor: 'download',
        title: '5. Verify another bundle',
        body: 'Use import signed bundle to check someone else\'s zip. Chordynaut recalculates hashes and confirms which Solana address signed it.'
    }
];

function bytesToHex(bytes) {
    return Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes) {
    let binary = '';
    bytes.forEach(byte => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary);
}

function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function base58ToBytes(value) {
    if (!value) return new Uint8Array();
    const bytes = [0];
    for (const char of value) {
        const carryStart = BASE58_ALPHABET.indexOf(char);
        if (carryStart < 0) {
            throw new Error('Invalid Solana address character.');
        }
        let carry = carryStart;
        for (let i = 0; i < bytes.length; i++) {
            const next = bytes[i] * 58 + carry;
            bytes[i] = next & 0xff;
            carry = next >> 8;
        }
        while (carry > 0) {
            bytes.push(carry & 0xff);
            carry >>= 8;
        }
    }
    for (const char of value) {
        if (char !== '1') break;
        bytes.push(0);
    }
    return new Uint8Array(bytes.reverse());
}

async function sha256Bytes(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return bytesToHex(new Uint8Array(digest));
}

async function sha256Blob(blob) {
    return sha256Bytes(await blob.arrayBuffer());
}

async function sha256Text(text) {
    return sha256Bytes(new TextEncoder().encode(text));
}

function getSolanaProvider() {
    if (window.solana?.isPhantom || window.solana?.signMessage) return window.solana;
    if (window.phantom?.solana?.signMessage) return window.phantom.solana;
    return null;
}

function shortWallet(address) {
    if (!address || address.length < 12) return address || '';
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function buildBundleMessage({ creatorWallet, createdAt, audioHash, performanceHash }) {
    return [
        'Chordynaut Signed Bundle v1',
        `app: ${window.location.origin}${window.location.pathname}`,
        `schema: ${CHORDYNAUT_SIGNED_BUNDLE_SCHEMA}`,
        `creator: ${creatorWallet}`,
        `createdAt: ${createdAt}`,
        `audioSha256: ${audioHash}`,
        `performanceSha256: ${performanceHash}`
    ].join('\n');
}

function verifySignedMessage({ creatorWallet, message, signature }) {
    if (!window.nacl?.sign?.detached?.verify) {
        throw new Error('Signature verification library did not load.');
    }
    const publicKeyBytes = base58ToBytes(creatorWallet);
    if (publicKeyBytes.length !== 32) {
        throw new Error('Receipt creator wallet is not a valid Solana public key.');
    }
    return window.nacl.sign.detached.verify(
        new TextEncoder().encode(message),
        base64ToBytes(signature),
        publicKeyBytes
    );
}

// Envelope Editor V2 Component
function EnvelopeEditorV2({
    value,
    onChange,
    maxTime = 4,
}) {
    const svgRef = useRef(null);
    const [dragging, setDragging] = useState(null);
    const [tooltip, setTooltip] = useState(null);
    const [altPressed, setAltPressed] = useState(false);

    const width = 260; // Smaller width
    const height = 120; // Smaller height
    const padding = 10;
    const plotWidth = width - 2 * padding;
    const plotHeight = height - 2 * padding;

    // Mapping helpers
    const timeToX = (t) => (t / maxTime) * plotWidth;
    const xToTime = (x) => Math.max(0, Math.min(maxTime, (x / plotWidth) * maxTime));
    const levelToY = (lv) => (1 - lv) * plotHeight;
    const yToLevel = (y) => {
        const lv = 1 - (y / plotHeight);
        return Math.max(0, Math.min(1, lv));
    };

    // Snapping grids
    const timeGrid = [0.05, 0.1, 0.2, 0.5, 1, 2, 3, 4];
    const sustainGrid = [0, 0.25, 0.5, 0.75, 1];

    const snap = (v, grid, pxPerUnit, tolerance = 6) => {
        if (altPressed) return v;
        for (const g of grid) {
            if (Math.abs(v - g) * pxPerUnit < tolerance) return g;
        }
        return v;
    };

    // Convert envelope to seconds for internal use
    const attack = value.attack / 1000;
    const decay = value.decay / 1000;
    const sustain = value.sustain / 100;
    const release = value.release / 1000;

    // Calculate positions
    const ax = timeToX(attack);
    const dx = timeToX(attack + decay);
    const rx = plotWidth - timeToX(release);
    const y1 = levelToY(1);
    const ys = levelToY(sustain);
    const y0 = levelToY(0);

    // Build polyline points
    const points = [
        [0, y0],
        [ax, y1],
        [dx, ys],
        [rx, ys],
        [plotWidth, y0],
    ].map(p => `${p[0] + padding},${p[1] + padding}`).join(' ');

    // Handle positions
    const handles = {
        attack: { x: ax + padding, y: y1 + padding, type: 'attack' },
        decay: { x: dx + padding, y: ys + padding, type: 'decay' },
        sustain: { x: (dx + rx) / 2 + padding, y: ys + padding, type: 'sustain' },
        release: { x: rx + padding, y: ys + padding, type: 'release' },
    };

    const handlePointerDown = (e) => {
        e.preventDefault();
        const svg = svgRef.current;
        const rect = svg.getBoundingClientRect();
        const x = e.clientX - rect.left - padding;
        const y = e.clientY - rect.top - padding;

        // Check handles first (44px touch target)
        const touchSize = 44;
        for (const [key, handle] of Object.entries(handles)) {
            const hx = handle.x - padding;
            const hy = handle.y - padding;
            if (Math.abs(x - hx) < touchSize / 2 && Math.abs(y - hy) < touchSize / 2) {
                setDragging({ type: 'handle', handle: key, startX: x, startY: y });
                return;
            }
        }

        // Check regions
        if (x >= 0 && x <= ax) {
            setDragging({ type: 'region', region: 'attack' });
            handleDrag(x, y, { type: 'region', region: 'attack' });
        } else if (x > ax && x <= dx) {
            setDragging({ type: 'region', region: 'decay' });
            handleDrag(x, y, { type: 'region', region: 'decay' });
        } else if (x > dx && x <= rx) {
            setDragging({ type: 'region', region: 'plateau' });
            handleDrag(x, y, { type: 'region', region: 'plateau' });
        } else if (x > rx && x <= plotWidth) {
            setDragging({ type: 'region', region: 'release' });
            handleDrag(x, y, { type: 'region', region: 'release' });
        }
    };

    const handleDrag = (x, y, dragState) => {
        const newEnv = { ...value };
        const pxPerSecond = plotWidth / maxTime;

        if (dragState.type === 'handle' || dragState.type === 'region') {
            const target = dragState.handle || dragState.region;

            if (target === 'attack') {
                let newAttack = snap(xToTime(x), timeGrid, pxPerSecond);
                newAttack = Math.max(0, Math.min(maxTime - decay / 1000 - release / 1000, newAttack));
                newEnv.attack = newAttack * 1000;
            } else if (target === 'decay') {
                let newDecay = snap(xToTime(x) - attack, timeGrid, pxPerSecond);
                newDecay = Math.max(0, Math.min(maxTime - attack - release / 1000, newDecay));
                newEnv.decay = newDecay * 1000;

                let newSustain = snap(yToLevel(y), sustainGrid, plotHeight);
                newEnv.sustain = newSustain * 100;
            } else if (target === 'sustain' || target === 'plateau') {
                let newSustain = snap(yToLevel(y), sustainGrid, plotHeight);
                newEnv.sustain = newSustain * 100;
            } else if (target === 'release') {
                let newRelease = snap(plotWidth - x, timeGrid, pxPerSecond / maxTime * plotWidth);
                newRelease = xToTime(newRelease);
                newRelease = Math.max(0, Math.min(maxTime - attack - decay / 1000, newRelease));
                newEnv.release = newRelease * 1000;
            }
        }

        onChange(newEnv);

        // Update tooltip
        setTooltip({
            x: x + padding,
            y: y + padding,
            text: `A:${(newEnv.attack / 1000).toFixed(2)}  D:${(newEnv.decay / 1000).toFixed(2)}  S:${(newEnv.sustain / 100).toFixed(2)}  R:${(newEnv.release / 1000).toFixed(2)}`
        });
    };

    const handlePointerMove = (e) => {
        if (!dragging) return;
        e.preventDefault();

        const svg = svgRef.current;
        const rect = svg.getBoundingClientRect();
        const x = e.clientX - rect.left - padding;
        const y = e.clientY - rect.top - padding;

        requestAnimationFrame(() => {
            handleDrag(x, y, dragging);
        });
    };

    const handlePointerUp = (e) => {
        e.preventDefault();
        setDragging(null);
        setTooltip(null);
    };

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Alt') setAltPressed(true);
        };
        const handleKeyUp = (e) => {
            if (e.key === 'Alt') setAltPressed(false);
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, []);

    return React.createElement('svg', {
        ref: svgRef,
        width: width,
        height: height,
        style: {
            border: '1px solid rgba(0,255,255,0.2)',
            borderRadius: '4px',
            background: 'rgba(10,15,25,0.5)',
            cursor: dragging ? 'grabbing' : 'grab',
            touchAction: 'none',
            display: 'block',
        },
        onPointerDown: handlePointerDown,
        onPointerMove: handlePointerMove,
        onPointerUp: handlePointerUp,
        onPointerCancel: handlePointerUp,
    },
        // Grid lines
        React.createElement('g', { opacity: 0.15 },
            // Vertical time divisions
            [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].map(t =>
                React.createElement('line', {
                    key: `v${t}`,
                    x1: timeToX(t) + padding,
                    y1: padding,
                    x2: timeToX(t) + padding,
                    y2: height - padding,
                    stroke: '#00ffff',
                    strokeWidth: 0.5,
                })
            ),
            // Horizontal level divisions
            [0.25, 0.5, 0.75].map(lv =>
                React.createElement('line', {
                    key: `h${lv}`,
                    x1: padding,
                    y1: levelToY(lv) + padding,
                    x2: width - padding,
                    y2: levelToY(lv) + padding,
                    stroke: '#00ffff',
                    strokeWidth: 0.5,
                })
            )
        ),

        // ADSR polyline
        React.createElement('polyline', {
            points: points,
            fill: 'none',
            stroke: '#ff0080',
            strokeWidth: 2,
            strokeLinejoin: 'round',
        }),

        // Invisible hit areas for regions (for tap-to-place)
        React.createElement('rect', {
            x: padding,
            y: padding,
            width: ax,
            height: plotHeight,
            fill: 'transparent',
            style: { cursor: 'pointer' }
        }),
        React.createElement('rect', {
            x: ax + padding,
            y: padding,
            width: dx - ax,
            height: plotHeight,
            fill: 'transparent',
            style: { cursor: 'pointer' }
        }),
        React.createElement('rect', {
            x: dx + padding,
            y: padding,
            width: rx - dx,
            height: plotHeight,
            fill: 'transparent',
            style: { cursor: 'pointer' }
        }),
        React.createElement('rect', {
            x: rx + padding,
            y: padding,
            width: plotWidth - rx,
            height: plotHeight,
            fill: 'transparent',
            style: { cursor: 'pointer' }
        }),

        // Handles with large invisible touch targets
        Object.entries(handles).map(([key, handle]) =>
            React.createElement('g', { key: key },
                // Invisible touch target (44x44px)
                React.createElement('circle', {
                    cx: handle.x,
                    cy: handle.y,
                    r: 22,
                    fill: 'transparent',
                    style: { cursor: 'grab' }
                }),
                // Visible handle
                React.createElement('circle', {
                    cx: handle.x,
                    cy: handle.y,
                    r: 4,
                    fill: '#00ffff',
                    stroke: '#ff0080',
                    strokeWidth: 1,
                })
            )
        ),

        // Tooltip
        tooltip && React.createElement('g', null,
            React.createElement('rect', {
                x: Math.min(tooltip.x + 5, width - 140),
                y: tooltip.y - 20,
                width: 135,
                height: 18,
                fill: 'rgba(0,0,0,0.8)',
                rx: 3,
            }),
            React.createElement('text', {
                x: Math.min(tooltip.x + 10, width - 135),
                y: tooltip.y - 8,
                fill: '#00ffff',
                fontSize: 10,
                fontFamily: 'monospace',
            }, tooltip.text)
        )
    );
}

// Metronome Popover Component
function MetronomePopover({ children, onClose }) {
    const popoverRef = useRef(null);

    useEffect(() => {
        const onDoc = (e) => {
            const el = popoverRef.current;
            if (el && !el.contains(e.target)) onClose();
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [onClose]);

    return React.createElement('div', {
        ref: popoverRef,
        className: 'metronome-popover',
        onClick: (e) => e.stopPropagation()
    }, children);
}

// Audio Engine
class AudioEngine {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.chordBus = null;
        this.strumBus = null;
        this.playbackOnlyGain = null;
        this.playbackOnlyCapture = false;
        this.outputCompressor = null;
        this.outputSafetyGain = null;
        this.outputSoftClipper = null;
        this.voices = new Map();
        this.maxVoices = 16;
        this.waveform = 'square';
        this.adsr = {
            attack: 10,
            decay: 100,
            sustain: 70,
            release: 200
        };
        this.volume = 0.8;
        this._voiceId = 0;
        this.loopTimer = null;
        
        // Audio recording setup
        this.mediaStreamDest = null;
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.recordingPurpose = null;
    }

    init(existingContext = null) {
        if (!this.audioContext) {
            this.audioContext = existingContext || new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = this.volume;
            
            this.chordBus = this.audioContext.createGain();
            this.chordBus.gain.value = 1.0;
            this.chordBus.connect(this.masterGain);
            
            this.strumBus = this.audioContext.createGain();
            this.strumBus.gain.value = 1.0;
            this.strumBus.connect(this.masterGain);
            
            this.outputCompressor = this.audioContext.createDynamicsCompressor();
            this.outputCompressor.threshold.value = -20;
            this.outputCompressor.knee.value = 10;
            this.outputCompressor.ratio.value = 12;
            this.outputCompressor.attack.value = 0;
            this.outputCompressor.release.value = 0.25;

            this.outputSafetyGain = this.audioContext.createGain();
            this.outputSafetyGain.gain.value = 0.82;

            this.outputSoftClipper = this.audioContext.createWaveShaper();
            const curve = new Float32Array(2048);
            for (let i = 0; i < curve.length; i++) {
                const x = (i / (curve.length - 1)) * 2 - 1;
                curve[i] = Math.tanh(1.8 * x) / Math.tanh(1.8);
            }
            this.outputSoftClipper.curve = curve;
            this.outputSoftClipper.oversample = '2x';
            
            this.masterGain.connect(this.outputCompressor);
            this.outputCompressor.connect(this.outputSafetyGain);
            this.outputSafetyGain.connect(this.outputSoftClipper);
            this.outputSoftClipper.connect(this.audioContext.destination);
            
            // Setup recorder destination
            this.mediaStreamDest = this.audioContext.createMediaStreamDestination();
            this.masterGain.connect(this.mediaStreamDest);

            // Audible playback that should not be baked into loop overdubs.
            this.playbackOnlyGain = this.audioContext.createGain();
            this.playbackOnlyGain.gain.value = 1.0;
            this.playbackOnlyGain.connect(this.outputCompressor);
        }
        
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }

    isRecordingAudio() {
        return !!this.mediaRecorder && this.mediaRecorder.state === 'recording';
    }

    setPlaybackOnlyCapture(enabled) {
        if (!this.playbackOnlyGain || !this.mediaStreamDest || this.playbackOnlyCapture === enabled) return;

        try {
            if (enabled) {
                this.playbackOnlyGain.connect(this.mediaStreamDest);
            } else {
                this.playbackOnlyGain.disconnect(this.mediaStreamDest);
            }
            this.playbackOnlyCapture = enabled;
        } catch (err) {
            this.playbackOnlyCapture = enabled;
        }
    }

    startRecording(purpose = 'generic') {
        this.init();
        if (!this.mediaStreamDest || this.isRecordingAudio()) return false;
        
        this.recordedChunks = [];
        this.mediaRecorder = new MediaRecorder(this.mediaStreamDest.stream);
        this.recordingPurpose = purpose;
        this.setPlaybackOnlyCapture(purpose === 'performance');
        this.mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) {
                this.recordedChunks.push(e.data);
            }
        };
        this.mediaRecorder.start();
        return true;
    }

    async stopRecording() {
        if (!this.mediaRecorder) return null;
        
        return new Promise((resolve) => {
            this.mediaRecorder.onstop = async () => {
                try {
                    const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
                    const arrayBuffer = await blob.arrayBuffer();
                    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
                    this.setPlaybackOnlyCapture(false);
                    this.recordingPurpose = null;
                    this.mediaRecorder = null;
                    resolve(audioBuffer);
                } catch (err) {
                    console.error('Error decoding audio:', err);
                    this.setPlaybackOnlyCapture(false);
                    this.recordingPurpose = null;
                    this.mediaRecorder = null;
                    resolve(null);
                }
            };
            this.mediaRecorder.stop();
        });
    }

    midiToFreq(midi) {
        return 440 * Math.pow(2, (midi - 69) / 12);
    }

    startGranularSample(sampleData, ratio, gainNode, startedAt) {
        const ac = this.audioContext;
        const buffer = sampleData.buffer;
        const loopStart = Math.max(0, sampleData.loopStart || 0);
        const loopEnd = Math.min(buffer.duration, sampleData.loopEnd || buffer.duration);
        const loopDuration = Math.max(0.08, loopEnd - loopStart);
        const grainDuration = Math.min(0.12, Math.max(0.055, loopDuration / 2));
        const grainHop = grainDuration / 2;
        const grainFade = Math.min(0.018, grainDuration / 4);
        const scheduleAhead = 0.16;
        const grainPeak = 0.62;

        const grains = new Set();
        let nextTime = startedAt;
        let timer = null;
        let stopTime = Infinity;
        let active = true;

        const clampOffset = (offset) => {
            const readSpan = grainDuration * Math.max(1, ratio) + 0.01;
            const maxOffset = Math.max(loopStart, loopEnd - readSpan);
            if (maxOffset <= loopStart) return loopStart;
            return Math.max(loopStart, Math.min(maxOffset, offset));
        };

        const scheduleGrain = (when) => {
            const source = ac.createBufferSource();
            const grainGain = ac.createGain();
            const elapsed = Math.max(0, when - startedAt);
            const readSpan = grainDuration * Math.max(1, ratio) + 0.01;
            const usableDuration = Math.max(grainHop, loopDuration - readSpan);
            const offset = clampOffset(loopStart + (elapsed % usableDuration));

            source.buffer = buffer;
            source.playbackRate.setValueAtTime(ratio, when);
            grainGain.gain.setValueAtTime(0.0001, when);
            grainGain.gain.linearRampToValueAtTime(grainPeak, when + grainFade);
            grainGain.gain.setValueAtTime(grainPeak, Math.max(when + grainFade, when + grainDuration - grainFade));
            grainGain.gain.linearRampToValueAtTime(0.0001, when + grainDuration);
            source.connect(grainGain).connect(gainNode);

            source.onended = () => grains.delete(source);
            grains.add(source);

            try {
                source.start(when, offset);
                source.stop(when + grainDuration + 0.02);
            } catch (err) {
                grains.delete(source);
            }
        };

        const schedule = () => {
            const now = ac.currentTime;
            const horizon = Math.min(now + scheduleAhead, stopTime);

            while (nextTime < horizon) {
                scheduleGrain(nextTime);
                nextTime += grainHop;
            }

            if (active || nextTime < stopTime) {
                timer = setTimeout(schedule, 35);
            } else {
                timer = null;
            }
        };

        schedule();

        return {
            stop: (when = ac.currentTime) => {
                stopTime = Math.min(stopTime, when);
                active = false;
                if (when <= ac.currentTime + 0.02 && timer) {
                    clearTimeout(timer);
                    timer = null;
                }
                grains.forEach(grain => {
                    try {
                        grain.stop(Math.max(ac.currentTime, when + 0.03));
                    } catch (err) {}
                });
            }
        };
    }

    noteOn(midiNote, velocity = 1.0, isChord = false, sampleData = null) {
        this.init();
        
        if (this.voices.has(midiNote)) {
            this.noteOff(midiNote);
        }
        
        const now = this.audioContext.currentTime;
        const freq = this.midiToFreq(midiNote);
        
        if (this.voices.size >= this.maxVoices) {
            const oldestKey = this.voices.keys().next().value;
            this.noteOff(oldestKey);
        }

        const bus = isChord ? this.chordBus : this.strumBus;
        const gainNode = this.audioContext.createGain();

        // Apply ADSR envelope with velocity scaling (convert ms to seconds)
        const attackTime = this.adsr.attack / 1000;
        const decayTime = this.adsr.decay / 1000;
        const targetAmp = this.volume * velocity;
        const sustainLevel = Math.max(0.01, (this.adsr.sustain / 100) * targetAmp);

        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(targetAmp, now + attackTime);
        gainNode.gain.exponentialRampToValueAtTime(sustainLevel, now + attackTime + decayTime);

        let source, filter;

        // Use sampled voice if provided
        if (sampleData && sampleData.buffer) {
            const ratio = freq / sampleData.baseFreq;
            
            filter = this.audioContext.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = freq * 3;
            filter.Q.value = 1;
            
            gainNode.connect(filter).connect(bus);
            source = this.startGranularSample(sampleData, ratio, gainNode, now);
        } else {
            // Use oscillator
            source = this.audioContext.createOscillator();
            source.type = this.waveform;
            source.frequency.value = freq;

            filter = this.audioContext.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = freq * 3;
            filter.Q.value = 1;

            source.connect(gainNode).connect(filter).connect(bus);
            source.start(now);
        }

        const id = ++this._voiceId;
        this.voices.set(midiNote, { id, source, gainNode, filter });
    }

    noteOff(midiNote) {
        const voice = this.voices.get(midiNote);
        if (!voice) return;

        const now = this.audioContext.currentTime;
        const releaseTime = this.adsr.release / 1000;
        const expectedId = voice.id;

        voice.gainNode.gain.cancelScheduledValues(now);
        voice.gainNode.gain.setValueAtTime(voice.gainNode.gain.value, now);
        voice.gainNode.gain.exponentialRampToValueAtTime(0.001, now + releaseTime);

        try {
            voice.source.stop(now + releaseTime);
        } catch {}

        setTimeout(() => {
            const v = this.voices.get(midiNote);
            if (v && v.id === expectedId) {
                this.voices.delete(midiNote);
            }
        }, releaseTime * 1000 + 50);
    }

    stopAllImmediately() {
        const now = this.audioContext ? this.audioContext.currentTime : 0;
        this.voices.forEach(voice => {
            try {
                voice.gainNode.gain.cancelScheduledValues(now);
                voice.gainNode.gain.setValueAtTime(0, now);
                voice.source.stop(now);
            } catch {}
        });
        this.voices.clear();
    }

    setWaveform(waveform) {
        this.waveform = waveform;
    }

    setADSR(adsr) {
        this.adsr = { ...this.adsr, ...adsr };
    }

    setVolume(volume) {
        this.volume = volume;
        if (this.masterGain) {
            this.masterGain.gain.setValueAtTime(volume, this.audioContext.currentTime);
        }
    }

    setChordVolume(volume) {
        if (this.chordBus) {
            this.chordBus.gain.setValueAtTime(volume, this.audioContext.currentTime);
        }
    }

    stopAll() {
        this.voices.forEach((voice, note) => {
            this.noteOff(note);
        });
    }
}

// Chord definitions
const CHORD_DEFINITIONS = {
    "maj": [0,4,7],
    "min": [0,3,7],
    "7th": [0,4,7,10],
    "dim": [0,3,6],
    "sus": [0,5,7],
    "maj7": [0,4,7,11],
    "min7": [0,3,7,10],
    "9th": [0,4,7,10,14],
    "min9": [0,3,7,10,14],
    "aug": [0,4,8],
    "add9": [0,4,7,14],
    "11th": [0,4,7,10,14,17],
    "13th": [0,4,7,10,14,17,21]
};

const AVAILABLE_QUALITIES = ["maj7","min7","9th","min9","11th","13th","aug","add9"];
const AVAILABLE_ROOTS = ["C#","D♭","D#","E♭","F#","G♭","G#","A♭","A#","B♭"];

const defaultQualities = ["maj", "min", "7th", "dim", "sus"];

// Mode definitions - melody scale intervals
const MODE_DEFS = {
    ionian: { name: "Major", offsets: [0,2,4,5,7,9,11] },
    dorian: { name: "Dorian", offsets: [0,2,3,5,7,9,10] },
    phrygian: { name: "Phrygian", offsets: [0,1,3,5,7,8,10] },
    lydian: { name: "Lydian", offsets: [0,2,4,6,7,9,11] },
    mixolydian: { name: "Mixolydian", offsets: [0,2,4,5,7,9,10] },
    aeolian: { name: "Natural Minor", offsets: [0,2,3,5,7,8,10] },
    locrian: { name: "Locrian", offsets: [0,1,3,5,6,8,10] },
    harmonicMinor: { name: "Harmonic Minor", offsets: [0,2,3,5,7,8,11] },
    melodicMinor: { name: "Melodic Minor", offsets: [0,2,3,5,7,9,11] },
    majorPentatonic: { name: "Major Pentatonic", offsets: [0,2,4,7,9] },
    minorPentatonic: { name: "Minor Pentatonic", offsets: [0,3,5,7,10] }
};

// Diatonic chord quality tables (triads)
const TRIADS_BY_MODE = {
    ionian: ['maj','min','min','maj','maj','min','dim'],
    dorian: ['min','min','maj','maj','min','dim','maj'],
    phrygian: ['min','maj','maj','min','dim','maj','min'],
    lydian: ['maj','maj','min','dim','maj','min','min'],
    mixolydian: ['maj','min','dim','maj','min','min','maj'],
    aeolian: ['min','dim','maj','min','min','maj','maj'],
    locrian: ['dim','maj','min','min','maj','maj','min'],
    harmonicMinor: ['min','dim','aug','min','maj','maj','dim'],
    melodicMinor: ['min','min','aug','maj','maj','dim','dim']
};

// Diatonic chord quality tables (sevenths)
const SEVENTHS_BY_MODE = {
    ionian: ['maj7','min7','min7','maj7','7th','min7','dim'],
    dorian: ['min7','min7','maj7','7th','min7','dim','maj7'],
    phrygian: ['min7','maj7','7th','min7','dim','maj7','min7'],
    lydian: ['maj7','maj7','min7','dim','maj7','min7','min7'],
    mixolydian: ['7th','min7','dim','maj7','min7','min7','maj7'],
    aeolian: ['min7','dim','maj7','min7','min7','maj7','7th'],
    locrian: ['dim','maj7','min7','min7','maj7','7th','min7'],
    harmonicMinor: ['min7','dim','maj7','min7','7th','maj7','dim'],
    melodicMinor: ['min7','min7','maj7','7th','7th','dim','dim']
};

// Helper: parent mode for pentatonics (for chord qualities)
function parentForPentatonic(mode) {
    if (mode === 'majorPentatonic') return 'ionian';
    if (mode === 'minorPentatonic') return 'aeolian';
    return mode;
}

// Chord Generator
class ChordGenerator {
    constructor() {
        this.chromatic = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    }

    noteToMidi(noteName) {
        const flatToSharp = {
            'D♭': 'C#', 'E♭': 'D#', 'G♭': 'F#', 'A♭': 'G#', 'B♭': 'A#'
        };
        const normalizedNote = flatToSharp[noteName] || noteName;
        
        const baseOctave = 4;
        const index = this.chromatic.indexOf(normalizedNote);
        if (index === -1) return 60;
        return 12 * baseOctave + index;
    }

    midiToNoteName(midiNote) {
        const noteIndex = midiNote % 12;
        const octave = Math.floor(midiNote / 12) - 1;
        return this.chromatic[noteIndex] + octave;
    }

    getChordNotes(root, quality) {
        const baseRoot = this.noteToMidi(root);
        const intervals = CHORD_DEFINITIONS[quality] || CHORD_DEFINITIONS['maj'];
        return intervals.map(interval => baseRoot + interval);
    }

    getStrumNotes(chordNotes) {
        const notes = [];
        const baseNotes = chordNotes.slice();
        
        for (let i = 0; i < 12; i++) {
            const noteIndex = i % baseNotes.length;
            const octave = Math.floor(i / baseNotes.length);
            notes.push(baseNotes[noteIndex] + (octave * 12));
        }
        
        return notes.reverse();
    }
}

// Helper: grid root from tonic (circle of fifths, unchanged)
function gridRootPcForColumn(tonicPc, col) {
    return (tonicPc + 7 * col) % 12;
}

// Build melody notes for strum pad using mode
function buildMelodyLaneNotes({ tonicPc, modeId, laneCount, topMidi = 84, bottomMidi = 48 }) {
    const offsets = MODE_DEFS[modeId].offsets;
    const isScaleTone = (m) => offsets.includes(((m % 12) - tonicPc + 12) % 12);

    const asc = [];
    for (let m = bottomMidi; m <= topMidi; m++) {
        if (isScaleTone(m)) asc.push(m);
    }

    const desc = asc.reverse(); // top = highest, bottom = lowest
    if (desc.length < laneCount) {
        while (desc.length < laneCount) desc.push(desc[desc.length - 1]);
    }
    return desc.slice(0, laneCount);
}

function nearestZeroCrossing(data, target, radius) {
    const start = Math.max(1, target - radius);
    const end = Math.min(data.length - 1, target + radius);
    let best = Math.max(0, Math.min(data.length - 1, target));
    let bestScore = Math.abs(data[best]);

    for (let i = start; i <= end; i++) {
        const signChange = (data[i - 1] <= 0 && data[i] >= 0) || (data[i - 1] >= 0 && data[i] <= 0);
        const score = signChange ? 0 : Math.abs(data[i]);
        if (score < bestScore) {
            best = i;
            bestScore = score;
            if (score === 0) break;
        }
    }

    return best;
}

function preprocessSampleData(raw, sampleRate) {
    if (!raw || !raw.length) {
        return { data: new Float32Array(1), loopStart: 0, loopEnd: 0 };
    }

    let mean = 0;
    for (let i = 0; i < raw.length; i++) mean += raw[i];
    mean /= raw.length;

    const centered = new Float32Array(raw.length);
    let peak = 0;
    for (let i = 0; i < raw.length; i++) {
        const v = raw[i] - mean;
        centered[i] = v;
        peak = Math.max(peak, Math.abs(v));
    }

    if (peak < 0.004) {
        return { data: centered, loopStart: 0, loopEnd: centered.length / sampleRate, tooQuiet: true };
    }

    const windowSize = Math.max(128, Math.floor(sampleRate * 0.006));
    const threshold = Math.max(0.008, peak * 0.035);
    let first = 0;
    let last = centered.length - 1;
    let foundStart = false;

    for (let i = 0; i < centered.length; i += windowSize) {
        let sum = 0;
        const end = Math.min(centered.length, i + windowSize);
        for (let j = i; j < end; j++) sum += centered[j] * centered[j];
        const rms = Math.sqrt(sum / Math.max(1, end - i));
        if (rms > threshold) {
            first = i;
            foundStart = true;
            break;
        }
    }

    for (let i = centered.length - windowSize; i >= 0; i -= windowSize) {
        let sum = 0;
        const end = Math.min(centered.length, i + windowSize);
        for (let j = i; j < end; j++) sum += centered[j] * centered[j];
        const rms = Math.sqrt(sum / Math.max(1, end - i));
        if (rms > threshold) {
            last = end;
            break;
        }
    }

    if (!foundStart || last <= first) {
        first = 0;
        last = centered.length;
    }

    const pad = Math.floor(sampleRate * 0.03);
    first = Math.max(0, first - pad);
    last = Math.min(centered.length, last + pad);

    const minLength = Math.min(centered.length, Math.floor(sampleRate * 0.16));
    if (last - first < minLength) {
        const mid = Math.floor((first + last) / 2);
        first = Math.max(0, mid - Math.floor(minLength / 2));
        last = Math.min(centered.length, first + minLength);
    }

    const trimmed = centered.slice(first, last);
    let trimmedPeak = 0;
    for (let i = 0; i < trimmed.length; i++) trimmedPeak = Math.max(trimmedPeak, Math.abs(trimmed[i]));

    const gain = trimmedPeak > 0 ? Math.min(8, 0.86 / trimmedPeak) : 1;
    const fadeIn = Math.min(Math.floor(sampleRate * 0.008), Math.floor(trimmed.length / 8));
    const fadeOut = Math.min(Math.floor(sampleRate * 0.025), Math.floor(trimmed.length / 6));

    for (let i = 0; i < trimmed.length; i++) {
        let env = 1;
        if (fadeIn > 0 && i < fadeIn) env *= i / fadeIn;
        if (fadeOut > 0 && i > trimmed.length - fadeOut) env *= (trimmed.length - i) / fadeOut;
        trimmed[i] = Math.max(-1, Math.min(1, trimmed[i] * gain * env));
    }

    const loopPad = Math.min(Math.floor(sampleRate * 0.025), Math.floor(trimmed.length / 5));
    const searchRadius = Math.floor(sampleRate * 0.012);
    let loopStartIndex = nearestZeroCrossing(trimmed, loopPad, searchRadius);
    let loopEndIndex = nearestZeroCrossing(trimmed, Math.max(loopStartIndex + 1, trimmed.length - loopPad), searchRadius);

    if (loopEndIndex - loopStartIndex < Math.floor(sampleRate * 0.08)) {
        loopStartIndex = 0;
        loopEndIndex = trimmed.length;
    }

    return {
        data: trimmed,
        loopStart: loopStartIndex / sampleRate,
        loopEnd: loopEndIndex / sampleRate,
        tooQuiet: false
    };
}

function strongestPitchWindow(data, sampleRate) {
    const size = Math.min(data.length, Math.max(2048, Math.min(8192, Math.floor(sampleRate * 0.18))));
    if (data.length <= size) return data;

    const step = Math.max(256, Math.floor(size / 4));
    let bestStart = 0;
    let bestRms = 0;

    for (let start = 0; start <= data.length - size; start += step) {
        let sum = 0;
        for (let i = 0; i < size; i++) {
            const v = data[start + i];
            sum += v * v;
        }
        const rms = Math.sqrt(sum / size);
        if (rms > bestRms) {
            bestRms = rms;
            bestStart = start;
        }
    }

    return data.subarray(bestStart, bestStart + size);
}

// Pitch detection using normalized autocorrelation on the strongest sample window.
function detectPitch(data, sampleRate) {
    const segment = strongestPitchWindow(data, sampleRate);
    if (!segment || segment.length < 512) return { frequency: 440, confidence: 0 };

    let mean = 0;
    for (let i = 0; i < segment.length; i++) mean += segment[i];
    mean /= segment.length;

    const minFreq = 70;
    const maxFreq = 1200;
    const minLag = Math.max(1, Math.floor(sampleRate / maxFreq));
    const maxLag = Math.min(segment.length - 2, Math.floor(sampleRate / minFreq));
    const usable = segment.length - maxLag;
    if (usable < 256) return { frequency: 440, confidence: 0 };

    let bestLag = -1;
    let bestScore = 0;
    const scores = new Float32Array(maxLag + 1);

    for (let lag = minLag; lag <= maxLag; lag++) {
        let corr = 0;
        let e1 = 0;
        let e2 = 0;

        for (let i = 0; i < usable; i++) {
            const a = segment[i] - mean;
            const b = segment[i + lag] - mean;
            corr += a * b;
            e1 += a * a;
            e2 += b * b;
        }

        const score = e1 > 0 && e2 > 0 ? corr / Math.sqrt(e1 * e2) : 0;
        scores[lag] = score;
        if (score > bestScore) {
            bestScore = score;
            bestLag = lag;
        }
    }

    if (bestLag < 0 || bestScore < 0.22) {
        return { frequency: 440, confidence: Math.max(0, bestScore) };
    }

    const prev = scores[bestLag - 1] || bestScore;
    const next = scores[bestLag + 1] || bestScore;
    const denom = prev - 2 * bestScore + next;
    const correction = Math.abs(denom) > 0.000001 ? 0.5 * (prev - next) / denom : 0;
    const refinedLag = bestLag + Math.max(-0.5, Math.min(0.5, correction));

    return {
        frequency: sampleRate / refinedLag,
        confidence: bestScore
    };
}

// Orientation check
function shouldEnforceLandscape() {
    const params = new URLSearchParams(window.location.search);
    const embedMode = params.get('embedMode');

    if (embedMode === 'square') return false;
    if (embedMode === 'maximized') return true;
    if (params.get('forceLandscape') === '1') return true;
    if (window.self !== window.top) return false;
    return true;
}

function checkOrientation() {
    const isLandscape = window.innerWidth > window.innerHeight;
    const orientationLock = document.getElementById('orientation-lock');
    const root = document.getElementById('root');
    const enforceLandscape = shouldEnforceLandscape();
    
    if (!orientationLock || !root) return;

    if (!enforceLandscape || isLandscape) {
        orientationLock.style.display = 'none';
        root.classList.remove('hidden');
        setTimeout(() => {
            if (window.recomputeLayout) window.recomputeLayout();
        }, 100);
    } else {
        orientationLock.style.display = 'flex';
        root.classList.add('hidden');
    }
}

function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || 
           (navigator.userAgent.includes("Mac") && "ontouchend" in document);
}

function getFullscreenElement() {
    return document.fullscreenElement ||
           document.webkitFullscreenElement ||
           document.msFullscreenElement ||
           null;
}

function isStandaloneDisplayMode() {
    return window.matchMedia('(display-mode: fullscreen)').matches ||
           window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
}

function isBrowserChromeNudged() {
    return document.documentElement.classList.contains('browser-chrome-nudge');
}

function canRequestFullscreen() {
    const el = document.documentElement;
    return !!(el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen);
}

function nudgeBrowserChrome() {
    document.documentElement.classList.add('browser-chrome-nudge');
    if (window.recomputeLayout) window.recomputeLayout();

    const scrollOnce = () => {
        try {
            window.scrollTo(0, 1);
        } catch (err) {}
    };

    requestAnimationFrame(scrollOnce);
    setTimeout(scrollOnce, 80);
    setTimeout(scrollOnce, 240);
}

function clearBrowserChromeNudge() {
    document.documentElement.classList.remove('browser-chrome-nudge');
    try {
        window.scrollTo(0, 0);
    } catch (err) {}
    if (window.recomputeLayout) window.recomputeLayout();
}

async function requestAppFullscreen() {
    const el = document.documentElement;

    if (el.requestFullscreen) {
        await el.requestFullscreen();
    } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
    } else if (el.msRequestFullscreen) {
        el.msRequestFullscreen();
    } else {
        throw new Error('Fullscreen API is not available');
    }

    if (screen.orientation && screen.orientation.lock) {
        try {
            await screen.orientation.lock('landscape');
        } catch (err) {
            // Orientation locking is optional and often blocked by mobile browsers.
        }
    }
}

async function exitAppFullscreen() {
    if (document.exitFullscreen) {
        await document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
    } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
    }

    if (screen.orientation && screen.orientation.unlock) {
        try {
            screen.orientation.unlock();
        } catch (err) {}
    }
}

// iOS Audio Start Overlay Component
function IOSStartOverlay({ onStart }) {
    const handleStart = useCallback(() => {
        const AC = window.AudioContext || window.webkitAudioContext;
        const ctx = new AC();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.0001;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.02);
        ctx.resume();
        
        onStart(ctx);
    }, [onStart]);

    return React.createElement('div', {
        id: 'ios-start-overlay',
        onClick: handleStart,
        style: {
            position: 'fixed',
            inset: 0,
            background: 'black',
            color: 'white',
            fontFamily: 'sans-serif',
            fontSize: '1.2em',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            zIndex: 9999,
            cursor: 'pointer',
            padding: '2rem'
        }
    }, 'tap anywhere to start (use one finger)');
}

// About Overlay Component
function AboutOverlay({ onClose, fullscreenMessage = '' }) {
    const isMobile = window.innerWidth < 1024;

    useEffect(() => {
        if (window.recomputeLayout) {
            window.recomputeLayout();
        }
        return () => {
            if (window.recomputeLayout) {
                setTimeout(() => window.recomputeLayout(), 0);
            }
        };
    }, []);

    return React.createElement('div', {
        className: 'config-overlay',
        style: { zIndex: 10000 }
    },
        React.createElement('div', {
            style: {
                width: '100%',
                maxWidth: '600px',
                background: 'rgba(26, 26, 46, 0.98)',
                borderRadius: '12px',
                padding: '30px',
                position: 'relative'
            }
        },
            React.createElement('h2', {
                style: {
                    fontSize: '1.8em',
                    marginBottom: '20px',
                    color: '#e94560',
                    textAlign: 'center'
                }
            }, 'About Chordynaut'),
            
            React.createElement('div', {
                style: {
                    fontSize: '1.1em',
                    lineHeight: '1.8',
                    color: '#e0e0e0',
                    marginBottom: '30px'
                }
            },
                React.createElement('div', { style: { display: 'flex', justifyContent: 'center', marginBottom: '18px' } },
                    React.createElement(SolanaMark, { className: 'about-solana-mark' })
                ),
                React.createElement('p', { style: { marginBottom: '15px' } },
                    'Chordynaut integrates Solana into a human-first music creation workflow.'
                ),
                React.createElement('p', { style: { marginBottom: '15px' } },
                    'The goal is not to replace musicians with chains. It is to let people create pieces with their hands, ears, timing, mistakes, and taste, then use blockchain records to preserve attribution, provenance, and the human-ness of the work.'
                ),
                React.createElement('p', { style: { marginBottom: '15px' } },
                    'Solana is the next integration target because low-cost, fast settlement can make musical timestamps, creator receipts, editions, and collaboration trails practical without interrupting the act of playing.'
                ),
                React.createElement('p', { style: { marginBottom: '15px' } },
                    'Chordynaut was originally made by ',
                    React.createElement('a', {
                        href: 'https://x.com/decentricity',
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        style: { color: '#2ec4b6', textDecoration: 'underline' }
                    }, 'Decentricity'),
                    ' / ',
                    React.createElement('a', {
                        href: 'https://linkedin.com/in/decentricity',
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        style: { color: '#2ec4b6', textDecoration: 'underline' }
                    }, 'Ms. Pandu Sastrowardoyo'),
                    '.'
                ),
                React.createElement('p', null,
                    'This instrument is inspired by the autoharps of the early 20th century as well as the Suzuki Omnichord, a digital harp created in the 1980s.'
                ),
                React.createElement('p', null,
                    'To be presented at 97Kobolab, Jakarta.'
                ),
                isMobile && React.createElement('p', {
                    style: { marginTop: '1em', fontSize: '0.9em', opacity: 0.8, textAlign: 'center' }
                }, 'For the best experience, use the fullscreen button. If your browser blocks fullscreen, drag this panel up once until the app fills the screen, then press OK.'),
                fullscreenMessage && React.createElement('p', {
                    style: { marginTop: '1em', fontSize: '0.9em', opacity: 0.9, textAlign: 'center', color: '#2ec4b6' }
                }, fullscreenMessage)
            ),
            
            React.createElement('button', {
                onClick: () => {
                    onClose();
                    if (window.recomputeLayout) {
                        setTimeout(() => window.recomputeLayout(), 0);
                    }
                },
                style: {
                    background: '#ff6faf',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '12px 40px',
                    fontWeight: 'bold',
                    fontSize: '1.1em',
                    color: 'black',
                    cursor: 'pointer',
                    width: '100%',
                    transition: 'all 0.2s'
                },
                onMouseEnter: (e) => {
                    e.target.style.background = '#ff85bf';
                    e.target.style.transform = 'scale(1.05)';
                },
                onMouseLeave: (e) => {
                    e.target.style.background = '#ff6faf';
                    e.target.style.transform = 'scale(1)';
                }
            }, 'OK')
        )
    );
}

function TutorialBubble({ step, index, total, anchorRect, onNext, onSkip }) {
    const viewportWidth = window.innerWidth || 1024;
    const bubbleWidth = Math.min(360, Math.max(260, viewportWidth - 32));
    const anchorCenter = anchorRect ? anchorRect.left + (anchorRect.width / 2) : viewportWidth - 196;
    const bubbleLeft = anchorRect
        ? Math.max(16, Math.min(anchorCenter - (bubbleWidth / 2), viewportWidth - bubbleWidth - 16))
        : Math.max(16, viewportWidth - bubbleWidth - 18);
    const bubbleTop = anchorRect ? anchorRect.bottom + 14 : 62;
    const arrowLeft = Math.max(18, Math.min(anchorCenter - bubbleLeft, bubbleWidth - 18));

    return React.createElement('div', {
        className: 'tutorial-layer',
        role: 'dialog',
        'aria-live': 'polite',
        'aria-label': 'Chordynaut quick start'
    },
        React.createElement('div', {
            className: 'tutorial-bubble',
            style: {
                left: `${bubbleLeft}px`,
                top: `${bubbleTop}px`,
                width: `${bubbleWidth}px`
            }
        },
            anchorRect && React.createElement('div', {
                className: 'tutorial-arrow',
                style: { left: `${arrowLeft}px` }
            }),
            React.createElement('div', { className: 'tutorial-kicker' }, `Quick start ${index + 1}/${total}`),
            React.createElement('h3', null, step.title),
            React.createElement('p', null, step.body),
            React.createElement('div', { className: 'tutorial-actions' },
                React.createElement('button', {
                    type: 'button',
                    className: 'tutorial-skip',
                    onClick: onSkip
                }, 'skip'),
                React.createElement('button', {
                    type: 'button',
                    className: 'tutorial-next',
                    onClick: onNext
                }, index + 1 === total ? 'start playing' : 'next')
            )
        )
    );
}

function getRowColor(quality, index) {
    if (defaultQualities.includes(quality)) return "";
    const hues = [200, 260, 320, 30, 90, 140];
    const hue = hues[index % hues.length];
    return `hsl(${hue}, 70%, 50%)`;
}

// Main App Component
function App() {
    const audioEngineRef = useRef(new AudioEngine());
    const chordGenRef = useRef(new ChordGenerator());
    
    // Anti-race guard for strum starts
    const recentStrumStarts = useRef(new Map());
    const STRUM_RECENT_TTL = 0.15;
    const STRUM_ZONES_COUNT = 12;
    
    const TONICS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    
    const [waveform, setWaveform] = useState('square');
    const [adsr, setAdsr] = useState({ attack: 10, decay: 100, sustain: 70, release: 200 });
    const [tonic, setTonic] = useState(() => {
        return localStorage.getItem('chordynaut.tonic') || 'F';
    });
    const [mode, setMode] = useState(() => {
        return localStorage.getItem('chordynaut.mode') || 'ionian';
    });
    const [latch, setLatch] = useState(false);
    const [chordVolume, setChordVolume] = useState(1.0);
    const [currentChord, setCurrentChord] = useState(null);
    const [activeChordButton, setActiveChordButton] = useState(null);
    const [activeStrumZones, setActiveStrumZones] = useState(new Set());
    const [strumPointers, setStrumPointers] = useState(new Map());
    const [showSettings, setShowSettings] = useState(false);
    const [showIOSOverlay, setShowIOSOverlay] = useState(isIOS());
    const [showConfig, setShowConfig] = useState(false);
    const [showAbout, setShowAbout] = useState(false);
    const [isFullscreenActive, setIsFullscreenActive] = useState(() => {
        return !!getFullscreenElement() || isStandaloneDisplayMode() || isBrowserChromeNudged();
    });
    const [fullscreenMessage, setFullscreenMessage] = useState('');
    const [tutorialStepIndex, setTutorialStepIndex] = useState(-1);
    const [tutorialAnchorRect, setTutorialAnchorRect] = useState(null);
    const shouldStartTutorialAfterAboutRef = useRef(false);
    const walletButtonRef = useRef(null);
    const recordButtonRef = useRef(null);
    const downloadButtonRef = useRef(null);
    const strumPadRef = useRef(null);
    
    // Countdown state
    const [countdown, setCountdown] = useState(0);
    const countdownTimerRef = useRef(null);
    const countdownActionRef = useRef(null);
    
    // Microphone sampling state
    const [sampleData, setSampleData] = useState({
        buffer: null,
        baseFreq: 440,
        isActive: false,
        loopStart: 0,
        loopEnd: 0,
        pitchConfidence: 0
    });
    const [currentVoice, setCurrentVoice] = useState('square');
    const [isRecordingSample, setIsRecordingSample] = useState(false);
    const [isClearSampleConfirmOpen, setIsClearSampleConfirmOpen] = useState(false);
    
    // Metronome state
    const [bpm, setBpm] = useState(100);
    const [timeSignature, setTimeSignature] = useState("4/4");
    const [isMetronomeOn, setIsMetronomeOn] = useState(false);
    const [barCount, setBarCount] = useState(0);
    const [metronomeMuted, setMetronomeMuted] = useState(false);
    const [currentBeat, setCurrentBeat] = useState(-1);
    const [showMetronomePopover, setShowMetronomePopover] = useState(false);
    
    const [extraRoots, setExtraRoots] = useState([]);
    const [extraQualities, setExtraQualities] = useState([]);
    
    const [isRecording, setIsRecording] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [recordedEvents, setRecordedEvents] = useState([]);
    const [recordStart, setRecordStart] = useState(0);
    
    // Loop state
    const [loopBuffers, setLoopBuffers] = useState([]);
    const [isLooping, setIsLooping] = useState(false);
    const [isOverdubbing, setIsOverdubbing] = useState(false);
    const [loopStartedMetronome, setLoopStartedMetronome] = useState(false);
    const loopStartTimeRef = useRef(0);
    const loopRecordTimeoutRef = useRef(null);
    const loopRecordingTokenRef = useRef(0);
    const loopBuffersRef = useRef([]);
    const playbackTimeoutsRef = useRef([]);
    
    // Loop length state with persistence
    const [loopLength, setLoopLength] = useState(() => {
        const v = localStorage.getItem('chordynaut.loopBars');
        const n = v ? parseInt(v, 10) : 4;
        return Number.isFinite(n) && n > 0 ? n : 4;
    });
    
    // Clear loop confirmation state
    const [isClearLoopConfirmOpen, setIsClearLoopConfirmOpen] = useState(false);
    
    useEffect(() => {
        localStorage.setItem('chordynaut.loopBars', String(loopLength));
    }, [loopLength]);

    useEffect(() => {
        loopBuffersRef.current = loopBuffers;
    }, [loopBuffers]);
    
    // Download state
    const [isDownloadOpen, setIsDownloadOpen] = useState(false);
    const [walletAddress, setWalletAddress] = useState('');
    const [bundleStatus, setBundleStatus] = useState('');
    const [isSigningBundle, setIsSigningBundle] = useState(false);
    const [isVerifyingBundle, setIsVerifyingBundle] = useState(false);
    const importInputRef = useRef(null);
    
    // Event tracking refs for export
    const loopEventsRef = useRef([]);
    const performanceEventsRef = useRef([]);
    
    const chordPointersRef = useRef(new Map());
    const currentChordRef = useRef(null);
    const activeChordPointerIdRef = useRef(null);
    const chordPointerOrderRef = useRef(0);
    
    // Melody mode override
    const strumNotesOverrideRef = useRef(null);

    const [chordDragSwitch, setChordDragSwitch] = useState(() => {
        return localStorage.getItem('chordynaut.chordDragSwitch') !== '0';
    });

    // Persist tonic and mode
    useEffect(() => {
        localStorage.setItem('chordynaut.tonic', tonic);
    }, [tonic]);

    useEffect(() => {
        localStorage.setItem('chordynaut.mode', mode);
    }, [mode]);

    useEffect(() => {
        localStorage.setItem('chordynaut.chordDragSwitch', chordDragSwitch ? '1' : '0');
    }, [chordDragSwitch]);

    const ROOTS = useMemo(() => {
        const chromatic = chordGenRef.current.chromatic;
        const fifthsPattern = [0, 7, 2, 9, 4, 11, 6];
        const tonicIndex = chromatic.indexOf(tonic);
        return fifthsPattern.map(offset => chromatic[(tonicIndex + offset) % 12]);
    }, [tonic]);

    const roots = useMemo(() => [...ROOTS, ...extraRoots], [ROOTS, extraRoots]);
    
    // Get chord qualities based on selected mode
    const qualities = useMemo(() => {
        const parentMode = parentForPentatonic(mode);
        const triads = TRIADS_BY_MODE[parentMode] || TRIADS_BY_MODE.ionian;
        const sevenths = SEVENTHS_BY_MODE[parentMode] || SEVENTHS_BY_MODE.ionian;
        
        // Map degrees to column colors based on quality
        const qualityColors = {
            'maj': ["#4f83ff","#4a78f0","#456edc","#3f65c8","#395bb4","#3452a0","#2e488c"],
            'min': ["#b15cff","#a456f0","#974add","#8a3fca","#7d34b6","#7029a3","#631f8f"],
            '7th': ["#ff77c7","#f46fbc","#e964b2","#de59a7","#d34f9d","#c84592","#bd3a88"],
            'dim': ["#ffcc5c","#f0be56","#e0b24d","#d1a544","#c1983a","#b18b31","#a17f28"],
            'sus': ["#33d681","#30c877","#2eba6d","#2bac63","#289e59","#26904f","#238245"],
            'aug': ["#ff6b35","#f26430","#e55d2a","#d85624","#cb4f1f","#be4819","#b14114"]
        };
        
        const base = [
            { label: 'maj', key: 'maj', colors: qualityColors['maj'] },
            { label: 'min', key: 'min', colors: qualityColors['min'] },
            { label: '7th', key: '7th', colors: qualityColors['7th'] },
            { label: 'dim', key: 'dim', colors: qualityColors['dim'] },
            { label: 'sus', key: 'sus', colors: qualityColors['sus'] }
        ];
        
        const extra = extraQualities.map((q, idx) => ({
            label: q,
            key: q,
            colors: Array(7).fill(getRowColor(q, idx))
        }));
        
        return [...base, ...extra];
    }, [mode, extraQualities]);

    const beatsPerBar = useMemo(() => parseInt(timeSignature.split("/")[0]), [timeSignature]);

    const finishTutorial = useCallback(() => {
        localStorage.setItem(CHORDYNAUT_TUTORIAL_SEEN_KEY, 'yes');
        setTutorialStepIndex(-1);
    }, []);

    const advanceTutorial = useCallback(() => {
        setTutorialStepIndex(current => {
            if (current + 1 >= CHORDYNAUT_TUTORIAL_STEPS.length) {
                localStorage.setItem(CHORDYNAUT_TUTORIAL_SEEN_KEY, 'yes');
                return -1;
            }
            return current + 1;
        });
    }, []);

    const getTutorialAnchorElement = useCallback((anchor) => {
        if (anchor === 'wallet') return walletButtonRef.current;
        if (anchor === 'record') return recordButtonRef.current;
        if (anchor === 'download') return downloadButtonRef.current;
        if (anchor === 'strum') return strumPadRef.current;
        return null;
    }, []);

    useEffect(() => {
        if (tutorialStepIndex < 0) {
            setTutorialAnchorRect(null);
            return undefined;
        }

        const updateAnchor = () => {
            const step = CHORDYNAUT_TUTORIAL_STEPS[tutorialStepIndex];
            const element = getTutorialAnchorElement(step?.anchor);
            if (!element) {
                setTutorialAnchorRect(null);
                return;
            }
            const rect = element.getBoundingClientRect();
            if (step?.anchor === 'strum') {
                setTutorialAnchorRect({
                    left: rect.left,
                    right: rect.right,
                    top: rect.top,
                    bottom: rect.top + 8,
                    width: rect.width,
                    height: 8
                });
                return;
            }
            setTutorialAnchorRect({
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height
            });
        };

        const raf = requestAnimationFrame(updateAnchor);
        window.addEventListener('resize', updateAnchor);
        window.visualViewport?.addEventListener('resize', updateAnchor);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', updateAnchor);
            window.visualViewport?.removeEventListener('resize', updateAnchor);
        };
    }, [getTutorialAnchorElement, tutorialStepIndex]);

    useEffect(() => {
        const hasSeenTutorial = localStorage.getItem(CHORDYNAUT_TUTORIAL_SEEN_KEY) === 'yes';
        if (hasSeenTutorial) return undefined;
        shouldStartTutorialAfterAboutRef.current = true;
        const timer = setTimeout(() => {
            setShowAbout(true);
        }, 400);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        const syncFullscreenState = () => {
            setIsFullscreenActive(!!getFullscreenElement() || isStandaloneDisplayMode() || isBrowserChromeNudged());
            checkOrientation();
            if (window.recomputeLayout) {
                setTimeout(() => window.recomputeLayout(), 0);
            }
        };

        document.addEventListener('fullscreenchange', syncFullscreenState);
        document.addEventListener('webkitfullscreenchange', syncFullscreenState);
        window.addEventListener('resize', syncFullscreenState);
        window.addEventListener('orientationchange', syncFullscreenState);

        syncFullscreenState();

        return () => {
            document.removeEventListener('fullscreenchange', syncFullscreenState);
            document.removeEventListener('webkitfullscreenchange', syncFullscreenState);
            window.removeEventListener('resize', syncFullscreenState);
            window.removeEventListener('orientationchange', syncFullscreenState);
        };
    }, []);

    // Universal countdown helper
    const startCountdown = useCallback((seconds, onDone) => {
        if (countdownTimerRef.current) return;
        setCountdown(seconds);
        countdownActionRef.current = onDone;

        let n = seconds;
        countdownTimerRef.current = setInterval(() => {
            n -= 1;
            if (n > 0) {
                setCountdown(n);
            } else {
                clearInterval(countdownTimerRef.current);
                countdownTimerRef.current = null;
                setCountdown(0);
                const cb = countdownActionRef.current;
                countdownActionRef.current = null;
                if (typeof cb === 'function') cb();
            }
        }, 1000);
    }, []);

    // Countdown cancellation helper
    const cancelCountdown = useCallback(() => {
        if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
        }
        setCountdown(0);
        countdownActionRef.current = null;
    }, []);

    // Helper functions for anti-race guard
    const markRecentStrum = useCallback((midi) => {
        const ac = audioEngineRef.current?.audioContext;
        if (!ac) return;
        recentStrumStarts.current.set(midi, ac.currentTime);
    }, []);

    const isRecentStrum = useCallback((midi) => {
        const ac = audioEngineRef.current?.audioContext;
        if (!ac) return false;
        const t = recentStrumStarts.current.get(midi);
        return t != null && (ac.currentTime - t) < STRUM_RECENT_TTL;
    }, []);

    const gcRecentStrums = useCallback(() => {
        const ac = audioEngineRef.current?.audioContext;
        if (!ac) return;
        const now = ac.currentTime;
        for (const [midi, t] of recentStrumStarts.current) {
            if (now - t >= STRUM_RECENT_TTL) recentStrumStarts.current.delete(midi);
        }
    }, []);

    // Helper functions for download
    const ts = useCallback(() => {
        return new Date().toISOString().replace(/[:.]/g, '-');
    }, []);

    const saveBlob = useCallback((name, blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
    }, []);

    // Convert AudioBuffer to WAV Blob
    const audioBufferToWav = useCallback((audioBuffer) => {
        const numChannels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const format = 1;
        const bitDepth = 16;
        
        const bytesPerSample = bitDepth / 8;
        const blockAlign = numChannels * bytesPerSample;
        
        const data = [];
        for (let i = 0; i < numChannels; i++) {
            data.push(audioBuffer.getChannelData(i));
        }
        
        const interleaved = new Int16Array(audioBuffer.length * numChannels);
        for (let i = 0; i < audioBuffer.length; i++) {
            for (let channel = 0; channel < numChannels; channel++) {
                const sample = Math.max(-1, Math.min(1, data[channel][i]));
                interleaved[i * numChannels + channel] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            }
        }
        
        const buffer = new ArrayBuffer(44 + interleaved.length * 2);
        const view = new DataView(buffer);
        
        const writeString = (offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };
        
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + interleaved.length * 2, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);
        writeString(36, 'data');
        view.setUint32(40, interleaved.length * 2, true);
        
        const interleavedView = new Int16Array(buffer, 44);
        interleavedView.set(interleaved);
        
        return new Blob([buffer], { type: 'audio/wav' });
    }, []);

    const connectSolanaWallet = useCallback(async () => {
        const provider = getSolanaProvider();
        if (!provider?.connect || !provider?.signMessage) {
            throw new Error('No Solana wallet with message signing was found. Try Phantom or Solflare.');
        }
        const result = await provider.connect();
        const address = result?.publicKey?.toString?.() || provider.publicKey?.toString?.();
        if (!address) {
            throw new Error('Connected wallet did not return a public key.');
        }
        setWalletAddress(address);
        setBundleStatus(`wallet connected: ${shortWallet(address)}`);
        return { provider, address };
    }, []);

    useEffect(() => {
        const provider = getSolanaProvider();
        if (!provider?.connect) return;
        provider.connect({ onlyIfTrusted: true })
            .then(result => {
                const address = result?.publicKey?.toString?.() || provider.publicKey?.toString?.();
                if (address) setWalletAddress(address);
            })
            .catch(() => {});
    }, []);

    const buildLoopWavBlob = useCallback(() => {
        if (!loopBuffers.length) return null;
        const ac = audioEngineRef.current.audioContext;
        if (!ac) return null;
        const totalLength = loopBuffers.reduce((sum, buf) => sum + buf.length, 0);
        const mergedBuffer = ac.createBuffer(
            loopBuffers[0].numberOfChannels,
            totalLength,
            loopBuffers[0].sampleRate
        );
        let offset = 0;
        loopBuffers.forEach(buf => {
            for (let ch = 0; ch < buf.numberOfChannels; ch++) {
                mergedBuffer.getChannelData(ch).set(buf.getChannelData(ch), offset);
            }
            offset += buf.length;
        });
        return audioBufferToWav(mergedBuffer);
    }, [audioBufferToWav, loopBuffers]);

    const buildPerformancePayload = useCallback((source, events, createdAt) => ({
        schema: 'chordynaut.performance.v1',
        app: 'Chordynaut',
        appVersion: CHORDYNAUT_APP_VERSION,
        type: source,
        createdAt,
        events,
        musicState: {
            bpm,
            timeSignature,
            tonic,
            mode,
            loopLength,
            waveform,
            currentVoice,
            adsr
        },
        creationInterface: 'direct Chordynaut browser performance'
    }), [adsr, bpm, currentVoice, loopLength, mode, timeSignature, tonic, waveform]);

    const getSignedBundleArtifacts = useCallback(() => {
        const createdAt = new Date().toISOString();
        if (loopBuffers.length && loopEventsRef.current?.length) {
            const audioBlob = buildLoopWavBlob();
            if (audioBlob) {
                const performancePayload = buildPerformancePayload('loop', loopEventsRef.current, createdAt);
                return { createdAt, audioBlob, performancePayload, source: 'loop' };
            }
        }

        if (window.performanceWavBlob && performanceEventsRef.current?.length) {
            const performancePayload = buildPerformancePayload('performance', performanceEventsRef.current, createdAt);
            return { createdAt, audioBlob: window.performanceWavBlob, performancePayload, source: 'performance' };
        }

        throw new Error('Record a performance or loop before signing a bundle.');
    }, [buildLoopWavBlob, buildPerformancePayload, loopBuffers.length]);

    const signBundle = useCallback(async () => {
        setIsSigningBundle(true);
        setBundleStatus('preparing signed bundle...');
        try {
            let provider = getSolanaProvider();
            let address = walletAddress || provider?.publicKey?.toString?.();
            if (!provider || !address) {
                const connected = await connectSolanaWallet();
                provider = connected.provider;
                address = connected.address;
            }
            if (!provider?.signMessage || !address) {
                throw new Error('Connect a Solana wallet before signing.');
            }

            const { createdAt, audioBlob, performancePayload, source } = getSignedBundleArtifacts();
            const performanceText = JSON.stringify(performancePayload, null, 2);
            const audioHash = await sha256Blob(audioBlob);
            const performanceHash = await sha256Text(performanceText);
            const message = buildBundleMessage({
                creatorWallet: address,
                createdAt,
                audioHash,
                performanceHash
            });
            const messageBytes = new TextEncoder().encode(message);
            const signed = await provider.signMessage(messageBytes, 'utf8');
            const signatureBytes = signed?.signature || signed;
            const signature = bytesToBase64(signatureBytes instanceof Uint8Array ? signatureBytes : new Uint8Array(signatureBytes));

            const receipt = {
                schema: CHORDYNAUT_SIGNED_BUNDLE_SCHEMA,
                app: 'Chordynaut',
                appUrl: `${window.location.origin}${window.location.pathname}`,
                appVersion: CHORDYNAUT_APP_VERSION,
                createdAt,
                creatorWallet: address,
                audio: {
                    file: 'audio.wav',
                    sha256: audioHash,
                    mediaType: 'audio/wav'
                },
                performance: {
                    file: 'performance.json',
                    sha256: performanceHash,
                    mediaType: 'application/json'
                },
                musicState: performancePayload.musicState,
                source,
                message,
                signature: {
                    type: 'ed25519',
                    encoding: 'base64',
                    value: signature
                }
            };

            if (!verifySignedMessage({
                creatorWallet: receipt.creatorWallet,
                message,
                signature
            })) {
                throw new Error('Wallet signature could not be verified locally.');
            }

            const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
            const zip = new JSZip();
            zip.file('audio.wav', audioBlob);
            zip.file('performance.json', performanceText);
            zip.file('receipt.json', JSON.stringify(receipt, null, 2));
            const bundle = await zip.generateAsync({ type: 'blob' });
            saveBlob(`chordynaut_signed_bundle_${ts()}.zip`, bundle);
            setBundleStatus(`signed bundle by ${shortWallet(receipt.creatorWallet)} downloaded`);
            setWalletAddress(receipt.creatorWallet);
        } catch (error) {
            console.error('[chordynaut] signed bundle failed', error);
            setBundleStatus(error.message || 'Unable to sign bundle.');
        } finally {
            setIsSigningBundle(false);
        }
    }, [connectSolanaWallet, getSignedBundleArtifacts, saveBlob, ts, walletAddress]);

    const importSignedBundle = useCallback(async (file) => {
        if (!file) return;
        setIsVerifyingBundle(true);
        setBundleStatus('verifying signed bundle...');
        try {
            const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
            const zip = await JSZip.loadAsync(file);
            const receiptFile = zip.file('receipt.json');
            if (!receiptFile) throw new Error('Bundle is missing receipt.json.');
            const receipt = JSON.parse(await receiptFile.async('text'));
            if (receipt.schema !== CHORDYNAUT_SIGNED_BUNDLE_SCHEMA) {
                throw new Error('This is not a Chordynaut signed bundle receipt.');
            }

            const audioFile = zip.file(receipt.audio?.file || 'audio.wav');
            const performanceFile = zip.file(receipt.performance?.file || 'performance.json');
            if (!audioFile || !performanceFile) {
                throw new Error('Bundle is missing audio.wav or performance.json.');
            }

            const audioBlob = await audioFile.async('blob');
            const performanceText = await performanceFile.async('text');
            const audioHash = await sha256Blob(audioBlob);
            const performanceHash = await sha256Text(performanceText);
            if (audioHash !== receipt.audio?.sha256) {
                throw new Error('Audio hash does not match the signed receipt.');
            }
            if (performanceHash !== receipt.performance?.sha256) {
                throw new Error('Performance hash does not match the signed receipt.');
            }

            const signatureValue = typeof receipt.signature === 'string'
                ? receipt.signature
                : receipt.signature?.value;
            const expectedMessage = buildBundleMessage({
                creatorWallet: receipt.creatorWallet,
                createdAt: receipt.createdAt,
                audioHash,
                performanceHash
            });
            if (receipt.message !== expectedMessage) {
                throw new Error('Receipt message does not match the bundle contents.');
            }
            const validSignature = verifySignedMessage({
                creatorWallet: receipt.creatorWallet,
                message: receipt.message,
                signature: signatureValue
            });
            if (!validSignature) {
                throw new Error('Solana wallet signature is invalid.');
            }

            const performancePayload = JSON.parse(performanceText);
            const events = Array.isArray(performancePayload.events) ? performancePayload.events : [];
            setRecordedEvents(events);
            performanceEventsRef.current = events;
            window.performanceWavBlob = audioBlob;

            const state = performancePayload.musicState || receipt.musicState || {};
            if (Number.isFinite(Number(state.bpm))) setBpm(Number(state.bpm));
            if (state.timeSignature) setTimeSignature(state.timeSignature);
            if (state.tonic) setTonic(state.tonic);
            if (state.mode) setMode(state.mode);
            if (Number.isFinite(Number(state.loopLength))) setLoopLength(Number(state.loopLength));
            if (state.waveform) setWaveform(state.waveform);
            if (state.currentVoice && state.currentVoice !== 'sample') setCurrentVoice(state.currentVoice);
            if (state.adsr) setAdsr(state.adsr);

            setWalletAddress(receipt.creatorWallet);
            setBundleStatus(`verified Chordynaut bundle signed by ${receipt.creatorWallet}`);
            setIsDownloadOpen(true);
        } catch (error) {
            console.error('[chordynaut] signed bundle import failed', error);
            setBundleStatus(error.message || 'Unable to verify bundle.');
            setIsDownloadOpen(true);
        } finally {
            setIsVerifyingBundle(false);
        }
    }, []);

    // Export function
    const exportSelection = useCallback(async (kind) => {
        const files = [];
        const stamp = ts();
        
        if (kind === 'loop_json' || kind === 'all') {
            if (loopEventsRef.current?.length) {
                files.push({
                    name: `loop_${stamp}.json`,
                    blob: new Blob([JSON.stringify({
                        type: 'loop',
                        events: loopEventsRef.current,
                        bpm: bpm,
                        timeSignature: timeSignature,
                        tonic: tonic
                    }, null, 2)], { type: 'application/json' })
                });
            }
        }
        
        if (kind === 'performance_json' || kind === 'all') {
            if (performanceEventsRef.current?.length) {
                files.push({
                    name: `performance_${stamp}.json`,
                    blob: new Blob([JSON.stringify({
                        type: 'performance',
                        events: performanceEventsRef.current,
                        bpm: bpm,
                        timeSignature: timeSignature,
                        tonic: tonic
                    }, null, 2)], { type: 'application/json' })
                });
            }
        }
        
        if ((kind === 'loop_wav' || kind === 'all') && loopBuffers.length > 0) {
            const ac = audioEngineRef.current.audioContext;
            const totalLength = loopBuffers.reduce((sum, buf) => sum + buf.length, 0);
            const mergedBuffer = ac.createBuffer(
                loopBuffers[0].numberOfChannels,
                totalLength,
                loopBuffers[0].sampleRate
            );
            
            let offset = 0;
            loopBuffers.forEach(buf => {
                for (let ch = 0; ch < buf.numberOfChannels; ch++) {
                    mergedBuffer.getChannelData(ch).set(buf.getChannelData(ch), offset);
                }
                offset += buf.length;
            });
            
            const wavBlob = audioBufferToWav(mergedBuffer);
            files.push({ name: `loop_${stamp}.wav`, blob: wavBlob });
        }
        
        if ((kind === 'performance_wav' || kind === 'all') && window.performanceWavBlob) {
            files.push({ name: `performance_${stamp}.wav`, blob: window.performanceWavBlob });
        }
        
        if (!files.length) return;
        
        if (files.length === 1 && kind !== 'all') {
            saveBlob(files[0].name, files[0].blob);
            setIsDownloadOpen(false);
            return;
        }
        
        const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
        const zip = new JSZip();
        files.forEach(f => zip.file(f.name, f.blob));
        const blob = await zip.generateAsync({ type: 'blob' });
        saveBlob(`chordynaut_export_${stamp}.zip`, blob);
        setIsDownloadOpen(false);
    }, [bpm, timeSignature, tonic, loopBuffers, ts, saveBlob, audioBufferToWav]);

    const handleIOSStart = useCallback((audioContext) => {
        audioEngineRef.current.init(audioContext);
        setShowIOSOverlay(false);
    }, []);

    const handleFullscreenClick = useCallback(async () => {
        if (isBrowserChromeNudged() && !getFullscreenElement() && !isStandaloneDisplayMode()) {
            clearBrowserChromeNudge();
            setFullscreenMessage('');
            setIsFullscreenActive(false);
            return;
        }

        if (isStandaloneDisplayMode()) {
            setFullscreenMessage('');
            setIsFullscreenActive(true);
            if (window.recomputeLayout) window.recomputeLayout();
            return;
        }

        if (!canRequestFullscreen()) {
            nudgeBrowserChrome();
            setFullscreenMessage(
                isIOS()
                    ? 'iPhone Safari does not allow normal in-page fullscreen for this kind of app. Add Chordynaut to the Home Screen, then launch it from that icon for the closest fullscreen mode.'
                    : 'This browser did not expose the Fullscreen API, so Chordynaut used the browser-chrome fallback. Drag this panel up if the address bar is still visible, then press OK.'
            );
            setIsFullscreenActive(true);
            setShowAbout(true);
            return;
        }

        try {
            if (getFullscreenElement()) {
                await exitAppFullscreen();
                clearBrowserChromeNudge();
                setIsFullscreenActive(false);
            } else {
                await requestAppFullscreen();
                clearBrowserChromeNudge();
                setIsFullscreenActive(true);
            }

            setFullscreenMessage('');
            checkOrientation();
            if (window.recomputeLayout) {
                setTimeout(() => window.recomputeLayout(), 0);
            }
        } catch (err) {
            nudgeBrowserChrome();
            setFullscreenMessage(
                isIOS()
                    ? 'iPhone Safari blocked in-page fullscreen. Add Chordynaut to the Home Screen, then launch it from that icon for the closest fullscreen mode.'
                    : 'Fullscreen was blocked by the browser, so Chordynaut used the browser-chrome fallback. Drag this panel up if the address bar is still visible, then press OK.'
            );
            setIsFullscreenActive(true);
            setShowAbout(true);
        }
    }, []);

    // Microphone sampling function
    const startMicSample = useCallback(async () => {
        try {
            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false
                    }
                });
            } catch (err) {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }
            const ac = audioEngineRef.current?.audioContext || new (window.AudioContext || window.webkitAudioContext)();
            audioEngineRef.current.init(ac);
            
            const source = ac.createMediaStreamSource(stream);
            const processor = ac.createScriptProcessor(4096, 1, 1);
            const chunks = [];
            
            source.connect(processor);
            processor.connect(ac.destination);
            setIsRecordingSample(true);

            processor.onaudioprocess = (e) => {
                const input = e.inputBuffer.getChannelData(0);
                chunks.push(new Float32Array(input));
            };

            setTimeout(async () => {
                processor.disconnect();
                source.disconnect();
                stream.getTracks().forEach(track => track.stop());
                setIsRecordingSample(false);

                const bufferLength = chunks.reduce((a, c) => a + c.length, 0);
                const merged = new Float32Array(bufferLength);
                let offset = 0;
                for (const c of chunks) {
                    merged.set(c, offset);
                    offset += c.length;
                }

                const processed = preprocessSampleData(merged, ac.sampleRate);
                const buffer = ac.createBuffer(1, processed.data.length, ac.sampleRate);
                buffer.copyToChannel(processed.data, 0, 0);
                const pitch = detectPitch(processed.data, ac.sampleRate);
                const baseFreq = pitch.frequency || 440;

                setSampleData({
                    buffer,
                    baseFreq,
                    isActive: true,
                    loopStart: processed.loopStart,
                    loopEnd: processed.loopEnd,
                    pitchConfidence: pitch.confidence || 0,
                    tooQuiet: !!processed.tooQuiet
                });
                setCurrentVoice('sample');
            }, 1500);

        } catch (err) {
            console.error("Mic access failed:", err);
            alert("Microphone access denied or unavailable");
            setIsRecordingSample(false);
        }
    }, []);

    const clearSample = useCallback(() => {
        setSampleData({ buffer: null, baseFreq: 440, isActive: false, loopStart: 0, loopEnd: 0, pitchConfidence: 0 });
        setCurrentVoice('square');
    }, []);

    useEffect(() => {
        if (currentVoice !== 'sample') {
            audioEngineRef.current.setWaveform(currentVoice);
        }
    }, [currentVoice]);

    useEffect(() => {
        audioEngineRef.current.setADSR(adsr);
    }, [adsr]);

    useEffect(() => {
        currentChordRef.current = currentChord;
    }, [currentChord]);

    useEffect(() => {
        setTimeout(() => {
            if (window.recomputeLayout) window.recomputeLayout();
        }, 50);
    }, [showSettings]);

    // Melody mode: toggle override based on chord state, tonic, and mode
    useEffect(() => {
        const anyChordDown = chordPointersRef.current.size > 0;
        
        if (!anyChordDown) {
            // Melody mode ON - rebuild with current mode
            const chromatic = chordGenRef.current.chromatic;
            const tonicPc = chromatic.indexOf(tonic);
            strumNotesOverrideRef.current = buildMelodyLaneNotes({
                tonicPc,
                modeId: mode,
                laneCount: STRUM_ZONES_COUNT,
                topMidi: 84,
                bottomMidi: 48
            });
        } else {
            // Chord mode ON
            strumNotesOverrideRef.current = null;
        }
    }, [tonic, mode, currentChord]);

    // Initialize melody mode on startup
    useEffect(() => {
        const chromatic = chordGenRef.current.chromatic;
        const tonicPc = chromatic.indexOf(tonic);
        strumNotesOverrideRef.current = buildMelodyLaneNotes({
            tonicPc,
            modeId: mode,
            laneCount: STRUM_ZONES_COUNT,
            topMidi: 84,
            bottomMidi: 48
        });
    }, []);

    useEffect(() => {
        if (!isMetronomeOn) {
            setCurrentBeat(-1);
            return;
        }

        const ac = audioEngineRef.current?.audioContext ||
                  new (window.AudioContext || window.webkitAudioContext)();

        let beat = 0;
        const interval = (60 / bpm) * 1000;

        const click = () => {
            setCurrentBeat(beat);
            
            if (!metronomeMuted) {
                const osc = ac.createOscillator();
                const gain = ac.createGain();
                gain.gain.value = beat === 0 ? 0.3 : 0.15;
                osc.frequency.value = beat === 0 ? 1200 : 800;
                osc.connect(gain).connect(ac.destination);
                osc.start();
                osc.stop(ac.currentTime + 0.05);
            }

            beat = (beat + 1) % beatsPerBar;
            if (beat === 0) setBarCount(prev => prev + 1);
        };

        click();
        const timer = setInterval(click, interval);
        return () => {
            clearInterval(timer);
            setCurrentBeat(-1);
        };
    }, [isMetronomeOn, bpm, beatsPerBar, metronomeMuted]);

    // Loop playback
    const hasLoopBuffers = loopBuffers.length > 0;

    useEffect(() => {
        if (!isLooping || !hasLoopBuffers) return;
        
        const ac = audioEngineRef.current.audioContext;
        const loopDur = loopLength * beatsPerBar * (60 / bpm);
        
        const playAllLoops = () => {
            const now = ac.currentTime;
            const output = audioEngineRef.current.playbackOnlyGain || audioEngineRef.current.masterGain;

            loopBuffersRef.current.forEach(buffer => {
                const src = ac.createBufferSource();
                src.buffer = buffer;
                src.connect(output);
                src.start(now);
            });
        };

        playAllLoops();
        const timer = setInterval(playAllLoops, loopDur * 1000);

        return () => clearInterval(timer);
    }, [isLooping, hasLoopBuffers, loopLength, bpm, beatsPerBar]);

    useEffect(() => {
        return () => {
            if (audioEngineRef.current.loopTimer) {
                clearInterval(audioEngineRef.current.loopTimer);
            }
            if (loopRecordTimeoutRef.current) {
                clearTimeout(loopRecordTimeoutRef.current);
            }
            playbackTimeoutsRef.current.forEach(clearTimeout);
        };
    }, []);

    useEffect(() => {
        const hardKill = () => {
            audioEngineRef.current.stopAllImmediately();
            chordPointersRef.current.clear();
            activeChordPointerIdRef.current = null;
            setActiveStrumZones(new Set());
            setStrumPointers(new Map());
            setActiveChordButton(null);
            setCurrentChord(null);
        };

        const onVis = () => {
            if (document.hidden) hardKill();
        };

        window.addEventListener('blur', hardKill);
        document.addEventListener('visibilitychange', onVis);

        return () => {
            window.removeEventListener('blur', hardKill);
            document.removeEventListener('visibilitychange', onVis);
        };
    }, []);

    const getZoneFromPointer = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const zoneHeight = rect.height / 12;
        const zone = Math.floor(y / zoneHeight);
        return zone >= 0 && zone < 12 ? zone : -1;
    };

    const recordEvent = useCallback((type, note, velocity = 1.0, source = 'performance') => {
        if (!isRecording && !isOverdubbing) return;
        const ac = audioEngineRef.current?.audioContext;
        if (!ac) return;
        
        const now = ac.currentTime;
        
        if (isRecording) {
            const event = {
                time: now - recordStart,
                type: type,
                note: note,
                velocity: velocity,
                source: source
            };
            setRecordedEvents(prev => [...prev, event]);
            performanceEventsRef.current = [...performanceEventsRef.current, event];
        }
        
        if (isOverdubbing) {
            const loopDur = loopLength * beatsPerBar * (60 / bpm);
            const rawLoopTime = now - loopStartTimeRef.current;
            const loopTime = loopDur > 0 ? ((rawLoopTime % loopDur) + loopDur) % loopDur : Math.max(0, rawLoopTime);
            const event = {
                time: loopTime,
                type: type,
                note: note,
                velocity: velocity,
                source: 'loop'
            };
            loopEventsRef.current = [...loopEventsRef.current, event];
        }
    }, [isRecording, isOverdubbing, recordStart, loopLength, beatsPerBar, bpm]);

    const cancelLoopRecording = useCallback(() => {
        if (loopRecordTimeoutRef.current) {
            clearTimeout(loopRecordTimeoutRef.current);
            loopRecordTimeoutRef.current = null;
        }
        loopRecordingTokenRef.current += 1;
        setIsOverdubbing(false);

        if (audioEngineRef.current.recordingPurpose === 'loop') {
            audioEngineRef.current.stopRecording();
        }
    }, []);

    const startLoopRecording = useCallback(async (lengthBars) => {
        const ac = audioEngineRef.current?.audioContext;
        if (!ac) return;
        if (loopRecordTimeoutRef.current || audioEngineRef.current.isRecordingAudio()) return;
        
        const loopDur = lengthBars * beatsPerBar * (60 / bpm);
        
        const started = audioEngineRef.current.startRecording('loop');
        if (!started) return;

        const token = ++loopRecordingTokenRef.current;
        setIsOverdubbing(true);
        setBarCount(0);
        loopStartTimeRef.current = ac.currentTime;
        
        loopRecordTimeoutRef.current = setTimeout(async () => {
            loopRecordTimeoutRef.current = null;
            const audioBuffer = await audioEngineRef.current.stopRecording();
            if (token === loopRecordingTokenRef.current && audioBuffer) {
                setLoopBuffers(prev => [...prev, audioBuffer]);
                console.log('Recorded loop buffer, duration:', audioBuffer.duration);
            }
            if (token === loopRecordingTokenRef.current) {
                setIsOverdubbing(false);
            }
        }, loopDur * 1000);
        
    }, [beatsPerBar, bpm]);

    const stopPerformancePlayback = useCallback(() => {
        playbackTimeoutsRef.current.forEach(clearTimeout);
        playbackTimeoutsRef.current = [];
        audioEngineRef.current.stopAllImmediately();
        setIsPlaying(false);
    }, []);

    const playRecording = useCallback(() => {
        if (!recordedEvents.length) return;
        const ac = audioEngineRef.current?.audioContext;
        if (!ac) return;

        stopPerformancePlayback();
        setIsPlaying(true);
        const sample = currentVoice === 'sample' ? sampleData : null;

        recordedEvents.forEach(ev => {
            const delay = ev.time * 1000;
            const timeout = setTimeout(() => {
                if (ev.type === "noteOn") {
                    audioEngineRef.current.noteOn(ev.note, ev.velocity, false, sample);
                } else if (ev.type === "noteOff") {
                    audioEngineRef.current.noteOff(ev.note);
                }
            }, delay);
            playbackTimeoutsRef.current.push(timeout);
        });

        const total = recordedEvents.at(-1)?.time || 0;
        const endTimeout = setTimeout(() => {
            audioEngineRef.current.stopAllImmediately();
            playbackTimeoutsRef.current = [];
            setIsPlaying(false);
        }, (total + 0.35) * 1000);
        playbackTimeoutsRef.current.push(endTimeout);
    }, [recordedEvents, stopPerformancePlayback, currentVoice, sampleData]);

    const playChord = useCallback((root, quality) => {
        const engine = audioEngineRef.current;
        const chordGen = chordGenRef.current;
        const oldChord = currentChordRef.current;
        
        const newChordNotes = chordGen.getChordNotes(root, quality);
        const newStrumNotes = chordGen.getStrumNotes(newChordNotes);
        
        setCurrentChord({ root, quality, notes: newChordNotes, strumNotes: newStrumNotes });
        setActiveChordButton(`${root}-${quality}`);
        
        // Clear melody override (chord mode ON)
        strumNotesOverrideRef.current = null;
        
        // Retarget strum pointers
        setStrumPointers(prev => {
            const next = new Map(prev);
            for (const [pid, p] of next.entries()) {
                const desired = newStrumNotes[p.zone] ?? null;

                if (p.note != null && p.note !== desired) {
                    engine.noteOff(p.note);
                    recordEvent("noteOff", p.note);
                }

                if (desired != null) {
                    const sample = currentVoice === 'sample' ? sampleData : null;
                    engine.noteOn(desired, p.velocity, false, sample);
                    recordEvent("noteOn", desired, p.velocity);
                    markRecentStrum(desired);
                    p.note = desired;
                    setActiveStrumZones(prevZones => {
                        const nz = new Set(prevZones);
                        nz.add(p.zone);
                        return nz;
                    });
                } else {
                    p.note = null;
                    setActiveStrumZones(prevZones => {
                        const nz = new Set(prevZones);
                        nz.delete(p.zone);
                        return nz;
                    });
                }
            }
            return next;
        });
        
        // Start chord tones
        const sample = currentVoice === 'sample' ? sampleData : null;
        newChordNotes.forEach(n => {
            engine.noteOn(n, 1.0, true, sample);
            recordEvent("noteOn", n, 1.0);
        });
        
        // Guarded cleanup
        setTimeout(() => {
            gcRecentStrums();
            if (!engine) return;

            const chordSet = new Set((currentChordRef.current?.notes) || newChordNotes);

            function heldByStrum(midi) {
                let held = false;
                setStrumPointers(prev => {
                    for (const [, p] of prev) { 
                        if (p.note === midi) { 
                            held = true; 
                            break; 
                        } 
                    }
                    return prev;
                });
                return held;
            }

            engine.voices.forEach((voice, midi) => {
                if (!chordSet.has(midi) && !heldByStrum(midi) && !isRecentStrum(midi)) {
                    engine.noteOff(midi);
                }
            });
        }, 60);
    }, [recordEvent, currentVoice, sampleData, markRecentStrum, gcRecentStrums, isRecentStrum]);

    const releaseChord = useCallback(() => {
        if (latch) return;
        
        const engine = audioEngineRef.current;
        if (!engine) return;
        
        const chord = currentChordRef.current;
        
        if (chord) {
            const allChordNotes = new Set([
                ...(chord.notes || []),
                ...(chord.strumNotes || [])
            ]);
            
            for (const [midi, v] of engine.voices.entries()) {
                if (allChordNotes.has(midi)) {
                    engine.noteOff(midi);
                    recordEvent("noteOff", midi);
                }
            }
        }
        
        engine.stopAllImmediately();
        
        currentChordRef.current = null;
        activeChordPointerIdRef.current = null;
        setCurrentChord(null);
        setActiveChordButton(null);
        setActiveStrumZones(new Set());
        setStrumPointers(new Map());
        
        // Restore melody override
        const chromatic = chordGenRef.current.chromatic;
        const tonicPc = chromatic.indexOf(tonic);
        strumNotesOverrideRef.current = buildMelodyLaneNotes({
            tonicPc,
            modeId: mode,
            laneCount: STRUM_ZONES_COUNT,
            topMidi: 84,
            bottomMidi: 48
        });
    }, [latch, recordEvent, tonic, mode]);

    const handleChordPointerDown = useCallback((e, root, quality) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);

        if (chordDragSwitch) {
            const order = ++chordPointerOrderRef.current;
            chordPointersRef.current.set(e.pointerId, { root, quality, order });
            activeChordPointerIdRef.current = e.pointerId;
            playChord(root, quality);
            return;
        }
        
        chordPointersRef.current.set(e.pointerId, { root, quality });
        
        playChord(root, quality);
    }, [playChord, chordDragSwitch]);

    const getChordPadFromPoint = useCallback((x, y) => {
        const el = document.elementFromPoint(x, y);
        const pad = el?.closest?.('.chord-button');
        if (!pad) return null;
        const root = pad.dataset.root;
        const quality = pad.dataset.quality;
        return root && quality ? { root, quality } : null;
    }, []);

    const playLatestHeldChord = useCallback(() => {
        let latestId = null;
        let latest = null;

        for (const [pid, pointer] of chordPointersRef.current.entries()) {
            if (!latest || pointer.order > latest.order) {
                latestId = pid;
                latest = pointer;
            }
        }

        activeChordPointerIdRef.current = latestId;

        if (latest) {
            playChord(latest.root, latest.quality);
        } else if (!latch) {
            releaseChord();
        }
    }, [playChord, releaseChord, latch]);

    const handleChordPointerMove = useCallback((e) => {
        if (!chordDragSwitch) return;
        e.preventDefault();

        const pointer = chordPointersRef.current.get(e.pointerId);
        if (!pointer) return;

        const next = getChordPadFromPoint(e.clientX, e.clientY);
        if (!next) return;

        const changed = pointer.root !== next.root || pointer.quality !== next.quality;
        if (!changed) return;

        pointer.root = next.root;
        pointer.quality = next.quality;
        chordPointersRef.current.set(e.pointerId, pointer);

        if (activeChordPointerIdRef.current === e.pointerId) {
            playChord(next.root, next.quality);
        }
    }, [chordDragSwitch, getChordPadFromPoint, playChord]);

    const handleChordPointerUp = useCallback((e) => {
        e.preventDefault();
        e.currentTarget.releasePointerCapture?.(e.pointerId);

        if (chordDragSwitch) {
            const wasActive = activeChordPointerIdRef.current === e.pointerId;
            chordPointersRef.current.delete(e.pointerId);

            if (wasActive) {
                playLatestHeldChord();
            }
            return;
        }
        
        chordPointersRef.current.delete(e.pointerId);
        
        if (chordPointersRef.current.size === 0 && !latch) {
            const engine = audioEngineRef.current;
            if (engine) {
                for (const pointer of strumPointers.values()) {
                    if (pointer.note != null) {
                        engine.noteOff(pointer.note);
                        recordEvent("noteOff", pointer.note);
                    }
                }
            }
            
            releaseChord();
        }
    }, [releaseChord, latch, strumPointers, recordEvent, chordDragSwitch, playLatestHeldChord]);

    const handleChordPointerCancel = useCallback((e) => {
        e.preventDefault();
        e.currentTarget.releasePointerCapture?.(e.pointerId);

        if (chordDragSwitch) {
            const wasActive = activeChordPointerIdRef.current === e.pointerId;
            chordPointersRef.current.delete(e.pointerId);

            if (wasActive) {
                playLatestHeldChord();
            }
            return;
        }
        
        chordPointersRef.current.delete(e.pointerId);
        
        if (chordPointersRef.current.size === 0 && !latch) {
            const engine = audioEngineRef.current;
            if (engine) {
                for (const pointer of strumPointers.values()) {
                    if (pointer.note != null) {
                        engine.noteOff(pointer.note);
                        recordEvent("noteOff", pointer.note);
                    }
                }
            }
            
            releaseChord();
        }
    }, [releaseChord, latch, strumPointers, recordEvent, chordDragSwitch, playLatestHeldChord]);

    const handleStrumPointerDown = useCallback((e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);

        const zone = getZoneFromPointer(e);
        if (zone === -1) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const relX = (e.clientX - rect.left) / rect.width;
        const velocity = Math.min(1, Math.max(0.05, relX));

        // Get active strum notes (melody or chord)
        const activeStrumNotes = strumNotesOverrideRef.current || currentChord?.strumNotes || [];
        
        let note = activeStrumNotes[zone] ?? null;
        if (note) {
            const prev = strumPointers.get(e.pointerId);
            if (!prev || prev.note !== note) {
                const sample = currentVoice === 'sample' ? sampleData : null;
                audioEngineRef.current.noteOn(note, velocity, false, sample);
                recordEvent("noteOn", note, velocity);
                markRecentStrum(note);
            }
        }

        setStrumPointers(prev => {
            const next = new Map(prev);
            next.set(e.pointerId, { zone, velocity, note });
            return next;
        });
        if (note !== null) {
            setActiveStrumZones(prev => new Set(prev).add(zone));
        }
    }, [currentChord, recordEvent, currentVoice, sampleData, strumPointers, markRecentStrum]);

    const handleStrumPointerMove = useCallback((e) => {
        e.preventDefault();
        const pointer = strumPointers.get(e.pointerId);
        if (!pointer) return;

        const newZone = getZoneFromPointer(e);
        if (newZone === -1) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const relX = (e.clientX - rect.left) / rect.width;
        const velocity = Math.min(1, Math.max(0.05, relX));

        const activeStrumNotes = strumNotesOverrideRef.current || currentChord?.strumNotes || [];

        if (!activeStrumNotes.length) {
            setStrumPointers(prev => {
                const next = new Map(prev);
                const p = next.get(e.pointerId);
                if (p) { p.zone = newZone; p.velocity = velocity; }
                return next;
            });
            return;
        }

        if (pointer.note != null && newZone !== pointer.zone) {
            audioEngineRef.current.noteOff(pointer.note);
            recordEvent("noteOff", pointer.note);
            setActiveStrumZones(prev => {
                const nz = new Set(prev);
                nz.delete(pointer.zone);
                return nz;
            });
        }

        const newNote = activeStrumNotes[newZone] ?? null;
        if (newNote != null) {
            const sample = currentVoice === 'sample' ? sampleData : null;
            audioEngineRef.current.noteOn(newNote, velocity, false, sample);
            recordEvent("noteOn", newNote, velocity);
            markRecentStrum(newNote);
            setStrumPointers(prev => {
                const next = new Map(prev);
                next.set(e.pointerId, { zone: newZone, velocity, note: newNote });
                return next;
            });
            setActiveStrumZones(prev => {
                const nz = new Set(prev);
                nz.add(newZone);
                return nz;
            });
        } else {
            setStrumPointers(prev => {
                const next = new Map(prev);
                next.set(e.pointerId, { zone: newZone, velocity, note: null });
                return next;
            });
        }
    }, [strumPointers, currentChord, recordEvent, currentVoice, sampleData, markRecentStrum]);

    const handleStrumPointerUp = useCallback((e) => {
        e.preventDefault();
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        
        const pointer = strumPointers.get(e.pointerId);
        if (pointer) {
            if (pointer.note != null) {
                audioEngineRef.current.noteOff(pointer.note);
                recordEvent("noteOff", pointer.note);
            }
            
            setActiveStrumZones(prev => {
                const next = new Set(prev);
                next.delete(pointer.zone);
                return next;
            });
            setStrumPointers(prev => {
                const next = new Map(prev);
                next.delete(e.pointerId);
                return next;
            });
        }
    }, [strumPointers, recordEvent]);

    const handleResetConfig = useCallback(() => {
        setExtraRoots([]);
        setExtraQualities([]);
    }, []);

    // Clear loop handler
    const handleClearLoop = useCallback(() => {
        // Stop looping and overdubbing
        setIsLooping(false);
        cancelLoopRecording();
        
        // Clear all loop buffers and events
        setLoopBuffers([]);
        loopEventsRef.current = [];
        
        // Clear any loop timers
        if (audioEngineRef.current.loopTimer) {
            clearInterval(audioEngineRef.current.loopTimer);
            audioEngineRef.current.loopTimer = null;
        }
        
        // Stop metronome if it was started by the loop
        if (loopStartedMetronome) {
            setIsMetronomeOn(false);
            setLoopStartedMetronome(false);
        }
        
        // Cancel any ongoing countdown
        cancelCountdown();
        
        // Close the confirmation dialog
        setIsClearLoopConfirmOpen(false);
    }, [loopStartedMetronome, cancelCountdown, cancelLoopRecording]);

    if (showIOSOverlay) {
        return React.createElement(IOSStartOverlay, { onStart: handleIOSStart });
    }

    if (showAbout) {
        return React.createElement(AboutOverlay, {
            onClose: () => {
                setShowAbout(false);
                if (shouldStartTutorialAfterAboutRef.current) {
                    shouldStartTutorialAfterAboutRef.current = false;
                    setTutorialStepIndex(0);
                }
            },
            fullscreenMessage
        });
    }

    return React.createElement('div', {
        className: 'app-shell flex flex-col overflow-hidden'
    },
        React.createElement('div', {
            className: 'top-bar flex-shrink-0 px-2 py-1 flex items-center justify-between bg-cosmic-panel'
        },
            React.createElement('div', {
                className: 'flex items-center gap-2'
            },
                React.createElement('button', {
                    className: 'fullscreen-btn',
                    title: isFullscreenActive ? 'exit fullscreen' : 'fullscreen mode',
                    onClick: handleFullscreenClick,
                    style: {
                        fontSize: '1.2em',
                        marginRight: '8px',
                        background: 'none',
                        border: 'none',
                        color: 'var(--accent-color, cyan)',
                        cursor: 'pointer',
                        transition: 'transform 0.2s ease',
                    },
                    onMouseDown: e => e.currentTarget.style.transform = 'scale(0.9)',
                    onMouseUp: e => e.currentTarget.style.transform = 'scale(1.0)',
                }, '⛶'),
                React.createElement(SolanaMark, { className: 'topbar-solana-mark' }),
                React.createElement('h1', {
                    className: 'logo-text text-sm font-bold bg-gradient-to-r from-cosmic-glow via-cosmic-secondary to-cosmic-tertiary bg-clip-text text-transparent cursor-pointer',
                    onClick: () => setShowAbout(true),
                    style: { userSelect: 'none' }
                }, 'Chordynaut'),
                countdown > 0 && React.createElement('span', {
                    className: 'countdown-badge',
                    title: 'recording starts in...'
                }, String(countdown)),
                React.createElement('div', {
                    className: 'voice-selector'
                },
                    ['square', 'sawtooth', 'triangle'].map(wave => 
                        React.createElement('button', {
                            key: wave,
                            className: `voice-btn ${currentVoice === wave ? 'active' : ''}`,
                            onClick: () => setCurrentVoice(wave),
                            title: wave,
                            style: { fontSize: '0.9em', padding: '2px 5px' }
                        }, 
                            wave === 'square' ? '▢' :
                            wave === 'sawtooth' ? '⋀' : '△'
                        )
                    ),
                    React.createElement('button', {
                        className: `voice-btn mic-btn ${currentVoice === 'sample' ? 'active' : ''} ${isRecordingSample ? 'recording' : ''}`,
                        onClick: () => {
                            if (!sampleData.isActive) {
                                startCountdown(3, () => {
                                    startMicSample();
                                });
                            } else {
                                setCurrentVoice('sample');
                            }
                        },
                        title: sampleData.isActive ? 'Use mic sample' : 'Record mic sample',
                        style: { fontSize: '0.9em', padding: '2px 5px' }
                    }, '🎤'),
                    sampleData.isActive && React.createElement('button', {
                        className: 'mic-clear-btn',
                        onClick: () => setIsClearSampleConfirmOpen(true),
                        title: 'Clear recorded sample',
                        style: { fontSize: '0.8em', padding: '2px 4px' }
                    }, '❌')
                )
            ),
            React.createElement('div', {
                className: 'flex items-center gap-1'
            },
                React.createElement('button', {
                    className: `record-btn ${isRecording ? 'active' : ''}`,
                    ref: recordButtonRef,
                    onClick: async () => {
                        const engine = audioEngineRef.current;
                        if (!isRecording) {
                            startCountdown(3, () => {
                                engine.init();
                                const ac = engine.audioContext;
                                setRecordedEvents([]);
                                performanceEventsRef.current = [];
                                window.performanceWavBlob = null;
                                engine.startRecording('performance');
                                setRecordStart(ac.currentTime);
                                setIsRecording(true);
                            });
                        } else {
                            setIsRecording(false);
                            if (audioEngineRef.current.recordingPurpose === 'performance') {
                                const audioBuffer = await engine.stopRecording();
                                window.performanceWavBlob = audioBuffer ? audioBufferToWav(audioBuffer) : null;
                                if (audioBuffer) {
                                    setBundleStatus('performance recording ready for signing');
                                }
                            }
                        }
                    },
                    style: { width: '24px', height: '24px', fontSize: '0.9em' }
                }, '⏺'),
                React.createElement('button', {
                    className: 'play-btn',
                    disabled: !isPlaying,
                    onClick: () => stopPerformancePlayback(),
                    style: { fontSize: '0.8em', padding: '3px 6px' }
                }, '■'),
                React.createElement('button', {
                    className: 'play-btn',
                    disabled: !recordedEvents.length || isRecording || isPlaying,
                    onClick: () => playRecording(),
                    style: { fontSize: '0.8em', padding: '3px 6px' }
                }, '▶'),
                React.createElement('span', {
                    style: { color: 'rgba(255,255,255,0.3)', margin: '0 2px', fontSize: '0.9em' }
                }, '|'),
                React.createElement('button', {
                    className: 'wallet-btn',
                    ref: walletButtonRef,
                    title: walletAddress ? `Connected: ${walletAddress}` : 'Connect Solana wallet',
                    onClick: async () => {
                        try {
                            await connectSolanaWallet();
                        } catch (error) {
                            console.error('[chordynaut] wallet connect failed', error);
                            setBundleStatus(error.message || 'Unable to connect wallet.');
                            setIsDownloadOpen(true);
                        }
                    }
                }, walletAddress ? shortWallet(walletAddress) : 'wallet'),
                React.createElement('span', {
                    style: { color: 'rgba(255,255,255,0.3)', margin: '0 2px', fontSize: '0.9em' }
                }, '|'),
                React.createElement('button', {
                    className: 'btn-icon download-btn',
                    ref: downloadButtonRef,
                    title: 'Download',
                    onClick: () => setIsDownloadOpen(true),
                    style: { fontSize: '0.9em', padding: '3px 5px' }
                }, '⬇️'),
                React.createElement('span', {
                    style: { color: 'rgba(255,255,255,0.3)', margin: '0 2px', fontSize: '0.9em' }
                }, '|'),
                React.createElement('button', {
                    className: 'clear-loop-btn',
                    onClick: () => setIsClearLoopConfirmOpen(true),
                    disabled: !isLooping && loopBuffers.length === 0 && !countdownTimerRef.current,
                    title: 'Clear loop',
                    style: { 
                        fontSize: '0.9em', 
                        padding: '3px 6px',
                        background: 'linear-gradient(135deg, rgba(255,0,128,.12), rgba(0,255,255,.08))',
                        border: '1px solid rgba(0,255,255,0.25)',
                        boxShadow: '0 0 8px rgba(255,0,128,0.3), inset 0 0 6px rgba(0,255,255,0.1)',
                        borderRadius: '6px',
                        color: 'white',
                        marginLeft: '6px',
                        cursor: 'pointer',
                        transition: 'box-shadow 0.2s, transform 0.2s',
                        opacity: (!isLooping && loopBuffers.length === 0 && !countdownTimerRef.current) ? 0.4 : 1
                    },
                    onMouseEnter: (e) => {
                        if (!e.currentTarget.disabled) {
                            e.currentTarget.style.boxShadow = '0 0 10px #ff0080, 0 0 20px #00f6ff';
                            e.currentTarget.style.transform = 'translateY(-1px)';
                        }
                    },
                    onMouseLeave: (e) => {
                        e.currentTarget.style.boxShadow = '0 0 8px rgba(255,0,128,0.3), inset 0 0 6px rgba(0,255,255,0.1)';
                        e.currentTarget.style.transform = 'translateY(0)';
                    }
                }, 'C'),
                React.createElement('button', {
                    className: `loop-btn ${isLooping ? 'active' : ''}`,
                    onClick: () => {
                        if (!isLooping) {
                            // If a countdown is already running, ignore double-press
                            if (countdownTimerRef.current) return;

                            // Do NOT start metronome or loop yet; wait for countdown to finish
                            startCountdown(3, () => {
                                // Sync start: metronome + loop + recording begin together
                                if (!isMetronomeOn) {
                                    setLoopStartedMetronome(true);
                                    setIsMetronomeOn(true);
                                } else {
                                    // If metro already on, reset bar count to align the downbeat
                                    setBarCount(0);
                                }

                                setBarCount(0);          // Reset bars for good measure
                                setIsLooping(true);      // Arm loop playback system

                                // Start first pass capture immediately for exactly one loop length
                                startLoopRecording(loopLength);
                            });
                        } else {
                            // Stopping loop (existing behavior preserved)
                            setIsLooping(false);
                            cancelLoopRecording();
                            setLoopBuffers([]);
                            loopEventsRef.current = [];
                            if (audioEngineRef.current.loopTimer) {
                                clearInterval(audioEngineRef.current.loopTimer);
                            }
                            if (loopStartedMetronome) setIsMetronomeOn(false);
                            setLoopStartedMetronome(false);

                            // If we were in a countdown toward starting, cancel it
                            cancelCountdown();
                        }
                    },
                    style: { fontSize: '0.9em', padding: '3px 6px' }
                }, '🔁'),
                React.createElement('button', {
                    className: `overdub-btn ${isOverdubbing ? 'active' : ''}`,
                    disabled: !isLooping && !countdownTimerRef.current,
                    onClick: () => {
                        if (isLooping) {
                            // Loop already playing → start overdub immediately, no countdown, no metro toggles
                            startLoopRecording(loopLength);
                        } else {
                            // Loop not active → behave like loop start with countdown sync
                            if (countdownTimerRef.current) return; // ignore double-press during countdown
                            startCountdown(3, () => {
                                if (!isMetronomeOn) {
                                    setLoopStartedMetronome(true);
                                    setIsMetronomeOn(true);
                                } else {
                                    setBarCount(0);
                                }
                                setBarCount(0);
                                setIsLooping(true);
                                startLoopRecording(loopLength);
                            });
                        }
                    },
                    style: { fontSize: '0.9em', padding: '3px 6px' }
                }, '⬤'),
                isMetronomeOn && React.createElement('div', {
                    className: 'metronome-pulse-container'
                },
                    [...Array(beatsPerBar)].map((_, i) =>
                        React.createElement('div', {
                            key: i,
                            className: `pulse-dot ${currentBeat === i ? 'active' : ''}`,
                            style: { width: '8px', height: '8px' }
                        })
                    )
                ),
                React.createElement('div', { className: 'flex items-center space-x-1' },
                    React.createElement('select', {
                        value: tonic,
                        onChange: (e) => setTonic(e.target.value),
                        className: 'bg-gray-800 text-white text-xs px-1 py-0.5 rounded border border-gray-600 focus:outline-none'
                    },
                        TONICS.map(t => React.createElement('option', { key: t, value: t }, t))
                    )
                ),
                React.createElement('button', {
                    onClick: () => {
                        setShowConfig(true);
                        setTimeout(() => {
                            if (window.recomputeLayout) window.recomputeLayout();
                        }, 0);
                    },
                    className: 'config-btn',
                    style: { fontSize: '0.8em', padding: '3px 6px' }
                }, '🎹🎚️'),
                React.createElement('button', {
                    onClick: () => {
                        setShowSettings(!showSettings);
                        setTimeout(() => {
                            if (window.recomputeLayout) window.recomputeLayout();
                        }, 0);
                    },
                    className: 'px-2 py-0.5 rounded bg-cosmic-accent text-gray-400 hover:bg-cosmic-highlight font-bold text-xs'
                }, showSettings ? '×' : '⚙')
            )
        ),

        showSettings && React.createElement('div', {
            className: 'settings-toolbar'
        },
            React.createElement('div', {
                className: 'envelope-wrap'
            },
                React.createElement(EnvelopeEditorV2, {
                    value: adsr,
                    onChange: setAdsr,
                    maxTime: 4,
                })
            ),
            React.createElement('div', {
                className: 'mode-group'
            },
                React.createElement('label', null, 'Mode'),
                React.createElement('select', {
                    value: mode,
                    onChange: (e) => setMode(e.target.value),
                    className: 'mode-select'
                },
                    Object.entries(MODE_DEFS).map(([key, def]) =>
                        React.createElement('option', { key: key, value: key }, def.name)
                    )
                )
            ),
            React.createElement('div', {
                className: 'looplen-group',
                style: { display: 'inline-flex', alignItems: 'center', gap: 8 }
            },
                React.createElement('label', { style: { opacity: 0.8 } }, 'loop'),
                React.createElement('select', {
                    value: loopLength,
                    onChange: (e) => setLoopLength(parseInt(e.target.value, 10)),
                    className: 'compact-select'
                },
                    [1, 2, 4, 8].map(b =>
                        React.createElement('option', { key: b, value: b }, `${b} bar${b > 1 ? 's' : ''}`)
                    )
                )
            ),
            React.createElement('label', {
                className: 'looplen-group',
                style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', opacity: 0.75 }
            },
                React.createElement('input', {
                    type: 'checkbox',
                    checked: chordDragSwitch,
                    onChange: (e) => setChordDragSwitch(e.target.checked)
                }),
                'drag chords'
            ),
            React.createElement('div', {
                className: 'volume-group'
            },
                React.createElement('label', null, 'Chord Volume'),
                React.createElement('input', {
                    type: 'range',
                    min: 0,
                    max: 1.5,
                    step: 0.01,
                    value: chordVolume,
                    onChange: (e) => {
                        const v = parseFloat(e.target.value);
                        setChordVolume(v);
                        const eng = audioEngineRef.current;
                        if (eng && eng.chordBus) {
                            eng.chordBus.gain.setValueAtTime(v, eng.audioContext.currentTime);
                        }
                    },
                    className: 'volume-slider'
                }),
                React.createElement('span', {
                    className: 'vol-readout'
                }, `${Math.round(chordVolume * 100)}%`)
            ),
            React.createElement('div', {
                className: 'metro-group',
                style: { position: 'relative' }
            },
                React.createElement('button', {
                    className: 'metro-btn',
                    onClick: () => setShowMetronomePopover(!showMetronomePopover)
                }, 'Metronome'),
                showMetronomePopover && React.createElement(MetronomePopover, {
                    onClose: () => setShowMetronomePopover(false)
                },
                    React.createElement('div', {
                        style: { display: 'flex', flexDirection: 'column', gap: '8px' }
                    },
                        React.createElement('label', {
                            style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9em' }
                        },
                            React.createElement('input', {
                                type: 'checkbox',
                                checked: isMetronomeOn,
                                onChange: (e) => setIsMetronomeOn(e.target.checked)
                            }),
                            'On'
                        ),
                        React.createElement('div', {
                            style: { display: 'flex', alignItems: 'center', gap: '6px' }
                        },
                            React.createElement('label', {
                                style: { fontSize: '0.9em', minWidth: '36px' }
                            }, 'BPM'),
                            React.createElement('input', {
                                type: 'number',
                                min: 30,
                                max: 240,
                                value: bpm,
                                onChange: (e) => setBpm(parseInt(e.target.value) || 100),
                                style: { 
                                    width: '60px',
                                    background: '#1a1a2e',
                                    color: 'white',
                                    border: '1px solid rgba(255,255,255,0.2)',
                                    borderRadius: '4px',
                                    padding: '2px 4px'
                                }
                            })
                        ),
                        React.createElement('div', {
                            style: { display: 'flex', alignItems: 'center', gap: '6px' }
                        },
                            React.createElement('label', {
                                style: { fontSize: '0.9em', minWidth: '36px' }
                            }, 'Sig'),
                            React.createElement('select', {
                                value: timeSignature,
                                onChange: (e) => setTimeSignature(e.target.value),
                                style: {
                                    background: '#1a1a2e',
                                    color: 'white',
                                    border: '1px solid rgba(255,255,255,0.2)',
                                    borderRadius: '4px',
                                    padding: '2px 4px'
                                }
                            },
                                ["2/4","3/4","4/4","6/8","7/8"].map(sig =>
                                    React.createElement('option', { key: sig, value: sig }, sig)
                                )
                            )
                        ),
                        React.createElement('label', {
                            style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9em' }
                        },
                            React.createElement('input', {
                                type: 'checkbox',
                                checked: metronomeMuted,
                                onChange: (e) => setMetronomeMuted(e.target.checked)
                            }),
                            'Mute'
                        )
                    )
                )
            )
        ),

        isClearSampleConfirmOpen && React.createElement('div', {
            className: 'overlay-backdrop',
            onClick: () => setIsClearSampleConfirmOpen(false)
        },
            React.createElement('div', {
                className: 'overlay-card',
                onClick: (e) => e.stopPropagation()
            },
                React.createElement('p', null, 'clear recorded sample?'),
                React.createElement('div', {
                    className: 'overlay-actions'
                },
                    React.createElement('button', {
                        onClick: () => {
                            clearSample();
                            setIsClearSampleConfirmOpen(false);
                        }
                    }, 'yes'),
                    React.createElement('button', {
                        onClick: () => setIsClearSampleConfirmOpen(false)
                    }, 'no')
                )
            )
        ),

        isClearLoopConfirmOpen && React.createElement('div', {
            className: 'overlay-backdrop',
            onClick: () => setIsClearLoopConfirmOpen(false)
        },
            React.createElement('div', {
                className: 'overlay-card',
                onClick: (e) => e.stopPropagation()
            },
                React.createElement('p', null, 'Clear loop and stop playback?'),
                React.createElement('div', {
                    className: 'overlay-actions'
                },
                    React.createElement('button', {
                        onClick: handleClearLoop
                    }, 'yes'),
                    React.createElement('button', {
                        onClick: () => setIsClearLoopConfirmOpen(false)
                    }, 'no')
                )
            )
        ),

        isDownloadOpen && React.createElement('div', {
            className: 'overlay-backdrop',
            onClick: () => setIsDownloadOpen(false)
        },
            React.createElement('div', {
                className: 'overlay-card',
                onClick: (e) => e.stopPropagation()
            },
                React.createElement('h3', null, 'download'),
                React.createElement('div', {
                    className: 'dl-grid'
                },
                    React.createElement('button', {
                        className: 'signed-bundle-btn',
                        disabled: isSigningBundle || (!loopBuffers.length && !window.performanceWavBlob),
                        onClick: () => signBundle()
                    }, isSigningBundle ? 'signing...' : 'sign bundle'),
                    React.createElement('button', {
                        className: 'import-bundle-btn',
                        disabled: isVerifyingBundle,
                        onClick: () => importInputRef.current?.click()
                    }, isVerifyingBundle ? 'verifying...' : 'import signed bundle'),
                    React.createElement('button', {
                        disabled: !loopEventsRef.current?.length,
                        onClick: () => exportSelection('loop_json')
                    }, 'loop (json)'),
                    React.createElement('button', {
                        disabled: !performanceEventsRef.current?.length,
                        onClick: () => exportSelection('performance_json')
                    }, 'performance (json)'),
                    React.createElement('button', {
                        disabled: !loopBuffers.length,
                        onClick: () => exportSelection('loop_wav')
                    }, 'loop (wav)'),
                    React.createElement('button', {
                        disabled: !window.performanceWavBlob,
                        onClick: () => exportSelection('performance_wav')
                    }, 'performance (wav)'),
                    React.createElement('button', {
                        disabled: !loopEventsRef.current?.length && 
                                  !performanceEventsRef.current?.length &&
                                  !loopBuffers.length && !window.performanceWavBlob,
                        onClick: () => exportSelection('all')
                    }, 'all')
                ),
                bundleStatus && React.createElement('p', {
                    className: 'bundle-status'
                }, bundleStatus),
                React.createElement('div', {
                    className: 'overlay-actions'
                },
                    React.createElement('button', {
                        onClick: () => setIsDownloadOpen(false)
                    }, 'close')
                )
            )
        ),

        showConfig && React.createElement('div', {
            className: 'config-overlay'
        },
            React.createElement('div', {
                className: 'config-header'
            },
                React.createElement('h2', null, 'Configure Chord Keyboard'),
                React.createElement('button', {
                    className: 'close-btn',
                    onClick: () => {
                        setShowConfig(false);
                        setTimeout(() => {
                            if (window.recomputeLayout) window.recomputeLayout();
                        }, 0);
                    }
                }, '✕')
            ),

            React.createElement('section', null,
                React.createElement('h3', null, 'Add Chord Rows (Qualities)'),
                React.createElement('div', {
                    className: 'button-grid'
                },
                    AVAILABLE_QUALITIES.map(q =>
                        React.createElement('button', {
                            key: q,
                            className: extraQualities.includes(q) ? 'active' : '',
                            onClick: () => {
                                if (!extraQualities.includes(q)) {
                                    setExtraQualities([...extraQualities, q]);
                                }
                            }
                        }, q)
                    )
                )
            ),

            React.createElement('section', null,
                React.createElement('h3', null, 'Add Chord Columns (Roots)'),
                React.createElement('div', {
                    className: 'button-grid'
                },
                    AVAILABLE_ROOTS.map(r =>
                        React.createElement('button', {
                            key: r,
                            className: extraRoots.includes(r) ? 'active' : '',
                            onClick: () => {
                                if (!extraRoots.includes(r)) {
                                    setExtraRoots([...extraRoots, r]);
                                }
                            }
                        }, r)
                    )
                )
            ),

            React.createElement('div', {
                style: {
                    width: '100%',
                    maxWidth: '600px',
                    display: 'flex',
                    gap: '12px',
                    marginTop: '20px'
                }
            },
                React.createElement('button', {
                    className: 'save-btn',
                    onClick: () => {
                        setShowConfig(false);
                        setTimeout(() => {
                            if (window.recomputeLayout) window.recomputeLayout();
                        }, 0);
                    },
                    style: { flex: 1 }
                }, 'Done'),
                React.createElement('button', {
                    onClick: handleResetConfig,
                    style: {
                        background: 'rgba(255,255,255,0.1)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        borderRadius: '8px',
                        padding: '10px 30px',
                        fontWeight: 'bold',
                        fontSize: '1em',
                        color: 'white',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        flex: 1
                    },
                    onMouseEnter: (e) => {
                        e.target.style.background = 'rgba(255,255,255,0.2)';
                    },
                    onMouseLeave: (e) => {
                        e.target.style.background = 'rgba(255,255,255,0.1)';
                    }
                }, 'Reset to Defaults')
            )
        ),

        React.createElement('div', {
            className: 'workspace flex-1 grid grid-cols-2 gap-1 p-1 min-h-0 overflow-hidden'
        },
            React.createElement('div', {
                className: 'chord-grid-root bg-cosmic-panel rounded flex flex-col overflow-hidden p-1'
            },
                React.createElement('div', {
                    className: 'chord-grid',
                    style: {
                        gridTemplateColumns: `repeat(${roots.length}, 1fr)`,
                        gridTemplateRows: `repeat(${qualities.length}, 1fr)`
                    }
                },
                    qualities.map((quality, rowIndex) =>
                        roots.map((root, chordIndex) => {
                            const shadeIndex = chordIndex % quality.colors.length;
                            const bgColor = quality.colors[shadeIndex];
                            
                            return React.createElement('button', {
                                key: `${root}-${quality.key}`,
                                'data-root': root,
                                'data-quality': quality.key,
                                onPointerDown: (e) => handleChordPointerDown(e, root, quality.key),
                                onPointerMove: handleChordPointerMove,
                                onPointerUp: handleChordPointerUp,
                                onPointerCancel: handleChordPointerCancel,
                                onContextMenu: (e) => e.preventDefault(),
                                onTouchStart: (e) => e.preventDefault(),
                                draggable: false,
                                className: `chord-button ${
                                    activeChordButton === `${root}-${quality.key}` ? 'active' : ''
                                } font-bold text-xs transition-all touch-none flex flex-col items-center justify-center`,
                                style: {
                                    backgroundColor: bgColor || getRowColor(quality.key, rowIndex)
                                }
                            },
                                React.createElement('span', { className: 'text-sm' }, root),
                                React.createElement('span', { className: 'text-xs opacity-75' }, quality.label)
                            );
                        })
                    )
                )
            ),

            React.createElement('div', {
                className: 'bg-cosmic-panel rounded flex flex-col overflow-hidden p-1'
            },
                React.createElement('div', {
                    className: 'flex-1 relative rounded overflow-hidden strum-pad',
                    ref: strumPadRef,
                    onPointerDown: handleStrumPointerDown,
                    onPointerMove: handleStrumPointerMove,
                    onPointerUp: handleStrumPointerUp,
                    onPointerCancel: handleStrumPointerUp,
                    onContextMenu: (e) => e.preventDefault(),
                    onTouchStart: (e) => e.preventDefault(),
                    draggable: false,
                    style: { 
                        touchAction: 'none',
                        backgroundImage: 'linear-gradient(135deg, rgba(0, 255, 163, 0.22), rgba(220, 31, 255, 0.18)), radial-gradient(circle at 50% 45%, rgba(255,255,255,0.12), rgba(0,0,0,0.18))',
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        backgroundRepeat: 'no-repeat'
                    }
                },
                    Array.from({ length: 12 }).map((_, i) => {
                        const chordGen = chordGenRef.current;
                        let noteName = '';
                        let isRootNote = false;
                        
                        // Use active strum notes (melody or chord)
                        const activeStrumNotes = strumNotesOverrideRef.current || currentChord?.strumNotes || [];
                        
                        if (activeStrumNotes.length > 0) {
                            const midiNote = activeStrumNotes[i];
                            noteName = chordGen.midiToNoteName(midiNote);
                            if (currentChord) {
                                isRootNote = midiNote % 12 === currentChord.notes[0] % 12;
                            }
                        }
                        
                        return React.createElement('div', {
                            key: i,
                            className: `strum-zone ${activeStrumZones.has(i) ? 'active' : ''}`,
                            style: {
                                height: `${100 / 12}%`,
                                position: 'absolute',
                                top: `${(i * 100) / 12}%`,
                                left: 0,
                                right: 0,
                                backgroundColor: isRootNote ? 'rgba(233, 69, 96, 0.4)' : 
                                                (i % 2 === 0 ? 'rgba(22, 33, 62, 0.6)' : 'rgba(15, 52, 96, 0.6)')
                            }
                        },
                            noteName && React.createElement('span', {
                                className: `strum-note-label ${isRootNote ? 'root-note' : ''}`,
                                style: {
                                    position: 'absolute',
                                    left: '8px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    fontSize: '11px',
                                    fontWeight: isRootNote ? 'bold' : 'normal',
                                    opacity: isRootNote ? 1 : 0.7,
                                    pointerEvents: 'none',
                                    textShadow: '0 1px 2px rgba(0,0,0,0.8)'
                                }
                            }, noteName)
                        );
                    })
                )
            )
        ),

        React.createElement('input', {
            ref: importInputRef,
            type: 'file',
            accept: '.zip,application/zip',
            style: { display: 'none' },
            onChange: async (event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) await importSignedBundle(file);
            }
        }),

        tutorialStepIndex >= 0 && React.createElement(TutorialBubble, {
            step: CHORDYNAUT_TUTORIAL_STEPS[tutorialStepIndex],
            index: tutorialStepIndex,
            total: CHORDYNAUT_TUTORIAL_STEPS.length,
            anchorRect: tutorialAnchorRect,
            onNext: advanceTutorial,
            onSkip: finishTutorial
        })
    );
}

window.addEventListener('load', () => {
    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(App));
