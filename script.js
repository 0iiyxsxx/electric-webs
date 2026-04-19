/**
 * dxio's electric webs
 * Core Logic Module
 */

class ElectricWebsApp {
    constructor() {
        this.state = {
            isTracking: false,
            hands: []
        };
        
        // DOM Elements
        this.menuScreen = document.getElementById('menu-screen');
        this.arScreen = document.getElementById('ar-screen');
        this.videoElement = document.getElementById('input-video');
        this.canvasElement = document.getElementById('output-canvas');
        this.ctx = this.canvasElement.getContext('2d');
        
        // MediaPipe Instances
        this.hands = null;
        this.camera = null;

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupMediaPipe();
        this.resizeCanvas();
        
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    setupEventListeners() {
        const startBtn = document.getElementById('btn-start');
        const backBtn = document.getElementById('btn-back');

        // Magnetic Button Effect (Desktop)
        if (window.matchMedia("(pointer: fine)").matches) {
            startBtn.addEventListener('mousemove', (e) => {
                const rect = startBtn.getBoundingClientRect();
                const x = e.clientX - rect.left - rect.width / 2;
                const y = e.clientY - rect.top - rect.height / 2;
                startBtn.style.transform = `translate(${x * 0.3}px, ${y * 
0.3}px)`;
            });
            startBtn.addEventListener('mouseleave', () => {
                startBtn.style.transform = 'translate(0, 0)';
            });
        }

        startBtn.addEventListener('click', () => this.startExperience());
        backBtn.addEventListener('click', () => this.stopExperience());
    }

    setupMediaPipe() {
        // Initialize MediaPipe Hands
        this.hands = new Hands({locateFile: (file) => {
            return 
`https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }});

        this.hands.setOptions({
            maxNumHands: 2,
            modelComplexity: 1, // 0=fast, 1=balanced, 2=accurate (heavy)
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        this.hands.onResults(this.onResults.bind(this));
    }

    async startExperience() {
        try {
            // UI Transition
            this.menuScreen.classList.remove('active');
            this.menuScreen.classList.add('hidden');
            this.arScreen.classList.remove('hidden');
            this.arScreen.classList.add('active');

            // Start Camera
            await this.startCamera();
            
            // Start Tracking Loop
            this.state.isTracking = true;
            this.renderLoop();

        } catch (err) {
            console.error("Camera/Tracking Error:", err);
            alert("Camera access denied or not supported. Please allow 
permissions.");
            this.stopExperience();
        }
    }

    stopExperience() {
        this.state.isTracking = false;
        
        if (this.camera) {
            this.camera.stop();
        }
        
        // Reset UI
        this.arScreen.classList.remove('active');
        this.arScreen.classList.add('hidden');
        this.menuScreen.classList.remove('hidden');
        this.menuScreen.classList.add('active');
        
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvasElement.width, 
this.canvasElement.height);
    }

    async startCamera() {
        return new Promise((resolve, reject) => {
            this.camera = new Camera(this.videoElement, {
                onFrame: async () => {
                    await this.hands.send({image: this.videoElement});
                },
                width: 640, // Optimized resolution for mobile performance
                height: 480
            });
            this.camera.start()
                .then(resolve)
                .catch(reject);
        });
    }

    resizeCanvas() {
        this.canvasElement.width = window.innerWidth;
        this.canvasElement.height = window.innerHeight;
    }

    /**
     * Core Logic: Process detected hands and draw connections
     */
    onResults(results) {
        this.state.hands = results.multiHandLandmarks;
    }

    /**
     * Rendering Loop
     */
    renderLoop() {
        if (!this.state.isTracking) return;

        requestAnimationFrame(() => this.renderLoop());

        // Clear Canvas
        this.ctx.clearRect(0, 0, this.canvasElement.width, 
this.canvasElement.height);

        const hands = this.state.hands;
        
        // Only draw if we have 2 hands
        if (hands && hands.length === 2) {
            this.drawElectricWebs(hands[0], hands[1]);
        } else if (hands && hands.length === 1) {
            // Optional: Draw skeleton for single hand
            // this.drawSkeleton(hands[0]); 
        }
    }

    /**
     * Draws glowing lines between corresponding fingers of two hands
     */
    drawElectricWebs(hand1, hand2) {
        // Determine which hand is Left and which is Right based on 
x-coordinate
        // (Assuming mirrored video, logic might need flip depending on 
device)
        // Simple heuristic: Hand with lower average X is Left (in 
non-mirrored), 
        // but since we mirror via CSS, visual Left is actually Right in 
data usually.
        // Let's just sort by center X to ensure consistent pairing.
        
        const h1CenterX = hand1.reduce((acc, l) => acc + l.x, 0) / 
hand1.length;
        const h2CenterX = hand2.reduce((acc, l) => acc + l.x, 0) / 
hand2.length;

        const leftHand = h1CenterX < h2CenterX ? hand1 : hand2;
        const rightHand = h1CenterX < h2CenterX ? hand2 : hand1;

        // Finger Tip Indices in MediaPipe
        // Thumb: 4, Index: 8, Middle: 12, Ring: 16, Pinky: 20
        const fingerTips = [4, 8, 12, 16, 20];

        this.ctx.save();
        
        // Electric Style Settings
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.globalCompositeOperation = 'lighter'; // Makes 
overlapping lines glow brighter

        fingerTips.forEach((tipIndex, i) => {
            const p1 = leftHand[tipIndex];
            const p2 = rightHand[tipIndex];

            // Convert normalized coordinates (0-1) to canvas coordinates
            const x1 = p1.x * this.canvasElement.width;
            const y1 = p1.y * this.canvasElement.height;
            const x2 = p2.x * this.canvasElement.width;
            const y2 = p2.y * this.canvasElement.height;

            // Dynamic Color based on finger index
            const hue = (i * 40) + 180; // Cycle through blues/purples
            const color = `hsl(${hue}, 100%, 60%)`;

            this.drawLightningBeam(x1, y1, x2, y2, color);
        });

        this.ctx.restore();
    }

    /**
     * Draws a jagged, glowing line to simulate electricity
     */
    drawLightningBeam(x1, y1, x2, y2, color) {
        const segments = 10; // How many jagged parts
        const jitter = 15;   // How wild the lightning is
        
        this.ctx.beginPath();
        this.ctx.moveTo(x1, y1);

        // Calculate vector
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.sqrt(dx*dx + dy*dy);
        
        // Generate intermediate points with noise
        for (let i = 1; i < segments; i++) {
            const t = i / segments;
            // Linear interpolation
            const lx = x1 + dx * t;
            const ly = y1 + dy * t;
            
            // Add perpendicular noise
            const noise = (Math.random() - 0.5) * jitter * (1 - Math.abs(t - 0.5) * 2); // Less noise at ends
            const angle = Math.atan2(dy, dx) + Math.PI / 2;
            
            const nx = lx + Math.cos(angle) * noise;
            const ny = ly + Math.sin(angle) * noise;
            
            this.ctx.lineTo(nx, ny);
        }

        this.ctx.lineTo(x2, y2);

        // Outer Glow (Thick, transparent)
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 8;
        this.ctx.shadowBlur = 20;
        this.ctx.shadowColor = color;
        this.ctx.globalAlpha = 0.4;
        this.ctx.stroke();

        // Inner Core (Thin, bright)
        this.ctx.beginPath();
        // Re-draw path for inner core (simplified for perf, could optimize)
        this.ctx.moveTo(x1, y1);
        for (let i = 1; i < segments; i++) {
             // Re-calc noise slightly differently for "flicker" effect
             const t = i / segments;
             const lx = x1 + dx * t;
             const ly = y1 + dy * t;
             const noise = (Math.random() - 0.5) * (jitter * 0.5);
             const angle = Math.atan2(dy, dx) + Math.PI / 2;
             const nx = lx + Math.cos(angle) * noise;
             const ny = ly + Math.sin(angle) * noise;
             this.ctx.lineTo(nx, ny);
        }
        this.ctx.lineTo(x2, y2);

        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 2;
        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = '#ffffff';
        this.ctx.globalAlpha = 0.9;
        this.ctx.stroke();
    }
}

// Initialize App when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
    window.app = new ElectricWebsApp();
});
