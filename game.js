const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// FAIR RESOLUTION RATIO CAM CONTROLLERS
const TARGET_RATIO = 16 / 9;
let viewScale = 1.0;
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    // Anchor aspect scales uniformly to prevent visual aspect cheats
    if (canvas.width / canvas.height > TARGET_RATIO) {
        viewScale = canvas.height / 540;
    } else {
        viewScale = canvas.width / 960;
    }
}
resize();
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => { setTimeout(resize, 200); });

// GLOBAL SIMULATION STATE MATRIX
let currentMode = "TRAINING";
let gameState = "BOOT";
const MAP_SIZE = 2500; 
let camera = { x: 0, y: 0, shakeIntensity: 0, shakeDecay: 0.9 };

// CONFIGURATION STATE
let settings = {
    graphics: "HIGH",
    particles: "ON",
    volMaster: 0.8,
    volSfx: 0.7,
    sensMove: 1.0,
    sensLook: 1.1
};

// 💾 QUANTUM PERSISTENT DISPATCH ARCHIVE (LOCALSTORAGE SAVES)
let rankData = {
    points: 150,
    basePointsPerRank: 500,
    tiers: ["RECRUIT I", "RECRUIT II", "ELITE I", "ELITE II", "PRO I", "VETERAN", "LEGENDARY"]
};

function loadStoredArchive() {
    const savedPoints = localStorage.getItem('GODSTRIKE_RP_DATA');
    if (savedPoints !== null) {
        rankData.points = parseInt(savedPoints, 10);
    }
}
function commitArchiveToDrive() {
    localStorage.setItem('GODSTRIKE_RP_DATA', rankData.points.toString());
}
loadStoredArchive();

let difficultyMultiplier = 1.0;

// NEURAL SAFE ZONE BATTLE ROYALE VARIABLES
let safeZone = {
    x: MAP_SIZE / 2, y: MAP_SIZE / 2,
    radius: MAP_SIZE * 0.7, targetRadius: MAP_SIZE * 0.7,
    collapseSpeed: 0.35, active: false
};
let zoneTimer = 0;

// AUDIO SYNTH INSTRUMENT COUPLING
const AudioSynth = {
    ctx: null,
    init() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); },
    play(freq, type, duration, volMod = 1) {
        if (!this.ctx || settings.volMaster === 0) return;
        try {
            let osc = this.ctx.createOscillator();
            let gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            gain.gain.setValueAtTime(volMod * settings.volMaster * (settings.volSfx), this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.00001, this.ctx.currentTime + duration);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(); osc.stop(this.ctx.currentTime + duration);
        } catch(e) {}
    }
};

// SIMULATION MATRIX ENTITIES
let player = {
    x: MAP_SIZE/2, y: MAP_SIZE/2, vx: 0, vy: 0, radius: 18, angle: 0,
    maxSpeed: 5.5, health: 100, maxHealth: 100, lastHitTime: 0,
    isFiring: false, lastFired: 0, fireInterval: 130,
    continuousFireTime: 0, dashActive: false, dashTime: 0
};

let buildings = []; let obstacles = []; let bullets = [];
let enemies = []; let teammates = []; let particles = [];
let deployedShields = []; let floatingTexts = [];

let cooldowns = {
    shield: { lastUsed: 0, duration: 12000 },
    bomb: { lastUsed: 0, duration: 5000 },
    dash: { lastUsed: 0, duration: 4000 }
};

let leftTouch = { id: null, startX: 0, startY: 0, currentX: 0, currentY: 0, active: false };
let rightTouch = { id: null, startX: 0, startY: 0, currentX: 0, currentY: 0, active: false };

function triggerCameraShake(amt) {
    camera.shakeIntensity = Math.max(camera.shakeIntensity, amt);
}

function spawnFloatingText(x, y, text, color) {
    floatingTexts.push({
        x, y, text, color,
        vy: -1.5, alpha: 1.0, life: 45
    });
}

function updateRankAndDifficultySystems() {
    let tierIndex = Math.min(Math.floor(rankData.points / rankData.basePointsPerRank), rankData.tiers.length - 1);
    let currentTierName = rankData.tiers[tierIndex];
    let localXP = rankData.points % rankData.basePointsPerRank;
    
    document.getElementById('rank-name-display').innerText = currentTierName;
    document.getElementById('rank-points-display').innerText = `${localXP} / ${rankData.basePointsPerRank} RP (TOTAL: ${rankData.points})`;
    document.getElementById('hud-rp-tracker').innerText = `${localXP} / ${rankData.basePointsPerRank} RP`;

    if (currentMode === "RANKED") {
        difficultyMultiplier = 1.0 + (tierIndex * 0.25) + (localXP / rankData.basePointsPerRank * 0.20);
    } else if (currentMode === "NORMAL") {
        difficultyMultiplier = 1.15;
    } else {
        difficultyMultiplier = 0.85;
    }
    document.getElementById('hud-difficulty-multiplier').innerText = `x${difficultyMultiplier.toFixed(2)}`;
    commitArchiveToDrive();
}

// COLD BOOT INITIALIZATION LOOP
initiateBootSystems();
function initiateBootSystems() {
    let progress = 0;
    let timer = setInterval(() => {
        progress += Math.random() * 18;
        if (progress >= 100) {
            clearInterval(timer);
            document.getElementById('boot-splash').classList.add('hidden');
            document.getElementById('start-menu').classList.remove('hidden');
            gameState = "MENU";
            updateRankAndDifficultySystems();
        }
        document.getElementById('boot-progress-fill').style.width = `${Math.min(100, progress)}%`;
    }, 50);
}

function checkLineOfSight(x1, y1, x2, y2) {
    // Raycast building box edges to occlude entities
    for (let b of buildings) {
        if (lineIntersectsRect(x1, y1, x2, y2, b.x, b.y, b.w, b.h)) return false;
    }
    return true;
}

function lineIntersectsRect(x1, y1, x2, y2, rx, ry, rw, rh) {
    return lineIntersectsLine(x1,y1,x2,y2, rx,ry,rx+rw,ry) ||
           lineIntersectsLine(x1,y1,x2,y2, rx,ry+rh,rx+rw,ry+rh) ||
           lineIntersectsLine(x1,y1,x2,y2, rx,ry,rx,ry+rh) ||
           lineIntersectsLine(x1,y1,x2,y2, rx+rw,ry,rx+rw,ry+rh);
}

function lineIntersectsLine(x1,y1,x2,y2, x3,y3,x4,y4) {
    let det = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
    if (det === 0) return false;
    let lambda = ((y4 - y3) * (x4 - x1) + (x3 - x4) * (y4 - y1)) / det;
    let gamma = ((y1 - y2) * (x4 - x1) + (x1 - x2) * (y4 - y1)) / det;
    return (0 < lambda && lambda < 1) && (0 < gamma && gamma < 1);
}

function buildBattlegroundLandscape() {
    buildings = []; obstacles = []; bullets = []; enemies = []; teammates = []; particles = []; deployedShields = []; floatingTexts = [];
    
    buildings.push({x: 400, y: 500, w: 250, h: 400, color: "rgba(10, 25, 50, 0.9)"});
    buildings.push({x: 1800, y: 600, w: 350, h: 300, color: "rgba(10, 25, 50, 0.9)"});
    buildings.push({x: 1000, y: 1400, w: 500, h: 200, color: "rgba(10, 25, 50, 0.9)"});
    buildings.push({x: 1100, y: 300, w: 300, h: 400, color: "rgba(10, 25, 50, 0.9)"});

    for (let i = 0; i < 22; i++) {
        obstacles.push({
            x: Math.random() * (MAP_SIZE - 200) + 100, y: Math.random() * (MAP_SIZE - 200) + 100, radius: Math.random() * 25 + 20
        });
    }
    obstacles = obstacles.filter(o => Math.hypot(o.x - MAP_SIZE/2, o.y - MAP_SIZE/2) > 250);

    let spawnTeammates = currentMode !== "TRAINING" ? 3 : 0;
    for(let i=0; i < spawnTeammates; i++) {
        teammates.push({
            id: i, x: MAP_SIZE/2 + (i * 60) - 90, y: MAP_SIZE/2 + 80, vx: 0, vy: 0, radius: 17, angle: 0, health: 100, lastFired: 0
        });
    }

    let baseEnemyCount = currentMode === "TRAINING" ? 5 : currentMode === "NORMAL" ? 8 : 14;
    let scaledEnemyCount = Math.floor(baseEnemyCount * (difficultyMultiplier >= 1.0 ? Math.min(difficultyMultiplier, 1.6) : 1.0));
    
    for(let i=0; i < scaledEnemyCount; i++) {
        let enemyMaxHealth = 100 * (currentMode === "RANKED" ? (1.0 + (difficultyMultiplier - 1.0) * 0.3) : 1.0);
        enemies.push({
            id: i, x: Math.random() * MAP_SIZE, y: Math.random() * (MAP_SIZE / 2 - 200),
            radius: 17, angle: 0, health: enemyMaxHealth, maxHealth: enemyMaxHealth, lastFired: 0, state: "PATROL"
        });
    }
    
    // SAFE ZONE CALIBRATION
    if (currentMode === "RANKED") {
        safeZone.active = true;
        safeZone.radius = MAP_SIZE * 0.8;
        safeZone.targetRadius = MAP_SIZE * 0.8;
        zoneTimer = 0;
        document.getElementById('zone-timer-ui').classList.remove('hidden');
    } else {
        safeZone.active = false;
        document.getElementById('zone-timer-ui').classList.add('hidden');
    }

    document.getElementById('enemies-remaining-ui').innerText = enemies.length;
    document.getElementById('kills-ui').innerText = "0";
}

document.getElementById('start-btn').addEventListener('click', () => {
    AudioSynth.init(); AudioSynth.play(520, "sine", 0.3, 0.5);
    updateRankAndDifficultySystems();
    
    gameState = "LOADING_MATCH";
    document.getElementById('start-menu').classList.add('hidden');
    document.getElementById('loading-difficulty-warning').innerText = `DIFFICULTY ACCEL COMPILER: x${difficultyMultiplier.toFixed(2)}`;
    
    const loadingScreen = document.getElementById('match-loading');
    loadingScreen.classList.remove('hidden');
    document.getElementById('loading-mode-title').innerText = `CONNECTING: ${currentMode} LOBBY`;

    let progress = 0;
    let timer = setInterval(() => {
        progress += Math.random() * 25;
        if (progress >= 100) {
            clearInterval(timer);
            loadingScreen.classList.add('hidden');
            document.getElementById('ui-layer').classList.remove('hidden');
            document.getElementById('current-mode-ui').innerText = currentMode;
            buildBattlegroundLandscape();
            player.health = 100; player.x = MAP_SIZE / 2; player.y = MAP_SIZE / 2;
            gameState = "PLAYING";
        }
        document.getElementById('match-progress-fill').style.width = `${Math.min(100, progress)}%`;
    }, 40);
});

function spawnSparks(x, y, color, qty = 6) {
    if (settings.particles !== "ON") return;
    for(let i=0; i<qty; i++) {
        particles.push({
            x, y, vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 8,
            life: 1.0, decay: Math.random() * 0.05 + 0.02, color, isTracer: false
        });
    }
}

// MULTI-TOUCH LISTENERS
canvas.addEventListener('touchstart', (e) => {
    if (gameState !== "PLAYING") return;
    for (let i = 0; i < e.changedTouches.length; i++) {
        let t = e.changedTouches[i];
        if (t.clientX < window.innerWidth / 2 && !leftTouch.active) {
            leftTouch.id = t.identifier; leftTouch.startX = t.clientX; leftTouch.startY = t.clientY;
            leftTouch.currentX = t.clientX; leftTouch.currentY = t.clientY; leftTouch.active = true;
        } else if (t.clientX >= window.innerWidth / 2 && !rightTouch.active) {
            rightTouch.id = t.identifier; rightTouch.startX = t.clientX; rightTouch.startY = t.clientY;
            rightTouch.currentX = t.clientX; rightTouch.currentY = t.clientY; rightTouch.active = true;
            player.isFiring = true;
        }
    }
}, {passive: true});

canvas.addEventListener('touchmove', (e) => {
    if (gameState !== "PLAYING") return;
    for (let i = 0; i < e.touches.length; i++) {
        let t = e.touches[i];
        if (t.identifier === leftTouch.id) {
            leftTouch.currentX = t.clientX; leftTouch.currentY = t.clientY;
        } else if (t.identifier === rightTouch.id) {
            rightTouch.currentX = t.clientX; rightTouch.currentY = t.clientY;
            let dx = rightTouch.currentX - rightTouch.startX;
            let dy = rightTouch.currentY - rightTouch.startY;
            if (Math.hypot(dx, dy) > 5) {
                player.angle = Math.atan2(dy, dx);
            }
        }
    }
}, {passive: true});

canvas.addEventListener('touchend', (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
        let t = e.changedTouches[i];
        if (t.identifier === leftTouch.id) { leftTouch.active = false; leftTouch.id = null; }
        else if (t.identifier === rightTouch.id) { rightTouch.active = false; rightTouch.id = null; player.isFiring = false; player.continuousFireTime = 0; }
    }
}, {passive: true});

// ABILITY HANDLING ACTIONS
document.getElementById('btn-deploy-dash').addEventListener('click', (e) => {
    e.stopPropagation();
    let now = Date.now();
    if (now - cooldowns.dash.lastUsed >= cooldowns.dash.duration && gameState === "PLAYING") {
        cooldowns.dash.lastUsed = now;
        player.dashActive = true; player.dashTime = 12; // 12 simulation physics tics
        AudioSynth.play(880, "triangle", 0.15, 0.6);
        triggerCameraShake(6);
        document.getElementById('dash-cooldown-overlay').style.height = "100%";
    }
});

document.getElementById('btn-deploy-shield').addEventListener('click', (e) => {
    e.stopPropagation();
    let now = Date.now();
    if (now - cooldowns.shield.lastUsed >= cooldowns.shield.duration && gameState === "PLAYING") {
        cooldowns.shield.lastUsed = now;
        deployedShields.push({
            x: player.x + Math.cos(player.angle) * 45, y: player.y + Math.sin(player.angle) * 45, radius: 40, health: 150, life: 360
        });
        AudioSynth.play(200, "square", 0.4, 0.4);
        document.getElementById('shield-cooldown-overlay').style.height = "100%";
    }
});

document.getElementById('btn-deploy-bomb').addEventListener('click', (e) => {
    e.stopPropagation();
    let now = Date.now();
    if (now - cooldowns.bomb.lastUsed >= cooldowns.bomb.duration && gameState === "PLAYING") {
        cooldowns.bomb.lastUsed = now;
        let bTargetX = player.x + Math.cos(player.angle) * 180;
        let bTargetY = player.y + Math.sin(player.angle) * 180;
        AudioSynth.play(110, "sawtooth", 0.6, 0.8);
        triggerCameraShake(18);
        
        setTimeout(() => {
            spawnSparks(bTargetX, bTargetY, "#ff0055", 35);
            enemies.forEach(en => {
                let d = Math.hypot(en.x - bTargetX, en.y - bTargetY);
                if (d < 160) {
                    let dmg = Math.floor(90 * (1 - d/160));
                    en.health -= dmg;
                    spawnFloatingText(en.x, en.y, `-${dmg}`, "#ff0055");
                }
            });
        }, 300);
        document.getElementById('bomb-cooldown-overlay').style.height = "100%";
    }
});

// MAIN ENGINE UPDATES
function gameTick() {
    if (gameState === "PLAYING") {
        updatePlayerMovementPhysics();
        updateNeuralSafeZone();
        processWeaponryFiringMatrix();
        processProjectiles();
        processEnemiesBotBrain();
        processEnvironmentFadingEffects();
        processInterfaceCooldowns();
    }
    renderEngineGraphics();
    requestAnimationFrame(gameTick);

    function gameTick() {
    if (gameState === "PLAYING") {
        updatePlayerMovementPhysics();
        updateNeuralSafeZone();
        processWeaponryFiringMatrix();
        processProjectiles();
        processEnemiesBotBrain();
        processTeammatesBotBrain(); // <--- ADD THIS LINE HERE!
        processEnvironmentFadingEffects();
        processInterfaceCooldowns();
    }
    renderEngineGraphics();
    requestAnimationFrame(gameTick);
}
    
}

function updatePlayerMovementPhysics() {
    let speed = player.maxSpeed;
    if (player.dashActive) {
        speed *= 2.8; player.dashTime--;
        if (player.dashTime <= 0) player.dashActive = false;
        if (settings.particles === "ON") {
            particles.push({ x: player.x, y: player.y, vx: 0, vy: 0, life: 0.4, decay: 0.05, color: "#ffaa00", isTracer: false });
        }
    }

    if (leftTouch.active) {
        let dx = leftTouch.currentX - leftTouch.startX;
        let dy = leftTouch.currentY - leftTouch.startY;
        let dist = Math.hypot(dx, dy);
        if (dist > 5) {
            let angle = Math.atan2(dy, dx);
            let intensity = Math.min(dist / 40, 1.0) * settings.sensMove;
            player.vx = Math.cos(angle) * speed * intensity;
            player.vy = Math.sin(angle) * speed * intensity;
        }
    } else {
        player.vx *= 0.2; player.vy *= 0.2;
    }

    player.x += player.vx; player.y += player.vy;

    // Rigid Wall Map Restrictors
    player.x = Math.max(player.radius, Math.min(MAP_SIZE - player.radius, player.x));
    player.y = Math.max(player.radius, Math.min(MAP_SIZE - player.radius, player.y));

    // Rigid obstacle collision system
    obstacles.forEach(o => {
        let d = Math.hypot(player.x - o.x, player.y - o.y);
        if (d < player.radius + o.radius) {
            let ang = Math.atan2(player.y - o.y, player.x - o.x);
            player.x = o.x + Math.cos(ang) * (player.radius + o.radius);
            player.y = o.y + Math.sin(ang) * (player.radius + o.radius);
        }
    });

    // Rigid Building Blockers
    buildings.forEach(b => {
        let cx = Math.max(b.x, Math.min(player.x, b.x + b.w));
        let cy = Math.max(b.y, Math.min(player.y, b.y + b.h));
        let d = Math.hypot(player.x - cx, player.y - cy);
        if (d < player.radius) {
            let ang = Math.atan2(player.y - cy, player.x - cx);
            player.x = cx + Math.cos(ang) * player.radius;
            player.y = cy + Math.sin(ang) * player.radius;
        }
    });

    // Ambient Regenerator
    if (Date.now() - player.lastHitTime > 3500 && player.health < player.maxHealth) {
        player.health = Math.min(player.maxHealth, player.health + 0.2);
        document.getElementById('regen-status-ui').innerText = "REGEN ACTIVE";
        document.getElementById('regen-status-ui').className = "regen-indicator txt-cyan";
    } else {
        document.getElementById('regen-status-ui').innerText = "SYSTEM STABLE";
        document.getElementById('regen-status-ui').className = "regen-indicator";
    }
    document.getElementById('health-ui').innerText = Math.floor(player.health);
    document.getElementById('hp-bar-fill').style.width = `${player.health}%`;
    if (player.health < 35) document.getElementById('hp-bar-fill').style.background = "#ff0055";
    else document.getElementById('hp-bar-fill').style.background = "#00ffcc";

    if (player.health <= 0) handleIntermissionFailure();
}

function updateNeuralSafeZone() {
    if (!safeZone.active) return;
    zoneTimer++;
    
    // Every 500 ticks, collapse down step-wise
    if (zoneTimer % 500 === 0) {
        safeZone.targetRadius = Math.max(150, safeZone.targetRadius * 0.65);
    }

    if (safeZone.radius > safeZone.targetRadius) {
        safeZone.radius -= safeZone.collapseSpeed;
    }

    let distToCenter = Math.hypot(player.x - safeZone.x, player.y - safeZone.y);
    if (distToCenter > safeZone.radius) {
        player.health -= 0.12; // Continuous environmental tick damage
        player.lastHitTime = Date.now();
        if (zoneTimer % 20 === 0) {
            spawnFloatingText(player.x, player.y - 20, "ZONE RISK", "#ff0055");
            triggerCameraShake(2);
        }
    }
}

function processWeaponryFiringMatrix() {
    if (player.isFiring) {
        player.continuousFireTime += 0.016;
        let now = Date.now();
        if (now - player.lastFired >= player.fireInterval) {
            player.lastFired = now;
            
            // KINETIC ADAPTIVE BULLET SPREAD COEFFICIENT
            let maxRecoilPenalty = 0.28; 
            let activeSpread = Math.min(maxRecoilPenalty, player.continuousFireTime * 0.4);
            let recoilModAngle = player.angle + (Math.random() - 0.5) * activeSpread;

            bullets.push({
                x: player.x + Math.cos(player.angle) * 22, y: player.y + Math.sin(player.angle) * 22,
                vx: Math.cos(recoilModAngle) * 14, vy: Math.sin(recoilModAngle) * 14,
                radius: 3, owner: "PLAYER", color: "#00f6ff",
                startX: player.x, startY: player.y
            });
            AudioSynth.play(440 - (activeSpread * 200), "sawtooth", 0.08, 0.3);
            triggerCameraShake(activeSpread * 8 + 1.5);
        }
    }
}

function processProjectiles() {
    for (let i = bullets.length - 1; i >= 0; i--) {
        let b = bullets[i];
        b.x += b.vx; b.y += b.vy;

        // Trace line segments for neon trailing maps
        if (settings.particles === "ON" && Math.random() > 0.4) {
            particles.push({
                x: b.x, y: b.y, vx: 0, vy: 0, life: 0.3, decay: 0.05, color: b.color, isTracer: true
            });
        }

        // Out of Bounds map delete
        if (b.x < 0 || b.x > MAP_SIZE || b.y < 0 || b.y > MAP_SIZE) { bullets.splice(i, 1); continue; }

        // Block collision
        let hitObject = false;
        for (let bldg of buildings) {
            if (b.x > bldg.x && b.x < bldg.x + bldg.w && b.y > bldg.y && b.y < bldg.y + bldg.h) {
                spawnSparks(b.x, b.y, "#52759e"); bullets.splice(i, 1); hitObject = true; break;
            }
        }
        if (hitObject) continue;

        for (let o of obstacles) {
            if (Math.hypot(b.x - o.x, b.y - o.y) < o.radius) {
                spawnSparks(b.x, b.y, "#fff"); bullets.splice(i, 1); hitObject = true; break;
            }
        }
        if (hitObject) continue;

        // Tactical shield absorption
        for (let s of deployedShields) {
            if (Math.hypot(b.x - s.x, b.y - s.y) < s.radius) {
                s.health -= 15; spawnSparks(b.x, b.y, "#00ffcc"); bullets.splice(i, 1); hitObject = true; break;
            }
        }
        if (hitObject) continue;

        // Damage resolution
        if (b.owner === "PLAYER") {
            for (let j = enemies.length - 1; j >= 0; j--) {
                let en = enemies[j];
                if (Math.hypot(b.x - en.x, b.y - en.y) < en.radius) {
                    let baseDmg = Math.floor(Math.random() * 8) + 18;
                    en.health -= baseDmg;
                    spawnSparks(b.x, b.y, "#ff0055", 5);
                    spawnFloatingText(en.x, en.y - 15, `${baseDmg}`, "#ffaa00");
                    bullets.splice(i, 1); hitObject = true;

                    if (en.health <= 0) {
                        spawnSparks(en.x, en.y, "#ff0055", 18);
                        enemies.splice(j, 1);
                        let currentKills = parseInt(document.getElementById('kills-ui').innerText, 10) + 1;
                        document.getElementById('kills-ui').innerText = currentKills;
                        document.getElementById('enemies-remaining-ui').innerText = enemies.length;
                        AudioSynth.play(587, "sine", 0.2, 0.4);

                        if (enemies.length === 0) handleIntermissionVictory();
                    }
                    break;
                }
            }
        } else {
            // BULLET FROM ENEMY HOSTILES
            if (Math.hypot(b.x - player.x, b.y - player.y) < player.radius) {
                let receivedDmg = Math.floor((Math.random() * 5 + 10) * (currentMode === "RANKED" ? difficultyMultiplier : 1.0));
                player.health -= receivedDmg;
                player.lastHitTime = Date.now();
                spawnSparks(b.x, b.y, "#ff0055", 8);
                spawnFloatingText(player.x, player.y - 15, `-${receivedDmg}`, "#ff0055");
                triggerCameraShake(6);
                AudioSynth.play(150, "sawtooth", 0.12, 0.6);
                bullets.splice(i, 1);
                break;
            }
        }
    }
}


function processTeammatesBotBrain() {
    teammates.forEach(tm => {
        let closestEnemy = null;
        let minDist = Infinity;

        // 🎯 TARGETING SENSORS: Find the nearest visible hostile on the field
        enemies.forEach(en => {
            let dist = Math.hypot(en.x - tm.x, en.y - tm.y);
            if (dist < minDist && checkLineOfSight(tm.x, tm.y, en.x, en.y)) {
                minDist = dist;
                closestEnemy = en;
            }
        });

        // 🏃‍♂️ ENGAGEMENT COMBAT ROUTINE
        if (closestEnemy && minDist < 500) {
            tm.angle = Math.atan2(closestEnemy.y - tm.y, closestEnemy.x - tm.x);
            
            // Advance toward combat or back away if too tight
            if (minDist > 140) {
                tm.x += Math.cos(tm.angle) * 2.5;
                tm.y += Math.sin(tm.angle) * 2.5;
            }

            // Squad Suppression System Firing Loop
            let now = Date.now();
            if (now - tm.lastFired > 450) { 
                tm.lastFired = now;
                bullets.push({
                    x: tm.x + Math.cos(tm.angle) * 22, y: tm.y + Math.sin(tm.angle) * 22,
                    vx: Math.cos(tm.angle) * 11, vy: Math.sin(tm.angle) * 11,
                    radius: 3, owner: "PLAYER", color: "#0055ff", // Triggers damage checks against enemies
                    startX: tm.x, startY: tm.y
                });
                AudioSynth.play(380, "sine", 0.05, 0.1);
            }
        } else {
            // 🛡️ ESCORT ROUTINE: Fall back to your coordinates if no active targets are near
            let distToPlayer = Math.hypot(player.x - tm.x, player.y - tm.y);
            if (distToPlayer > 90) {
                let followAngle = Math.atan2(player.y - tm.y, player.x - tm.x);
                tm.x += Math.cos(followAngle) * 3.2;
                tm.y += Math.sin(followAngle) * 3.2;
                tm.angle = followAngle;
            }
        }

        // Rigid Environmental Constraints & Boundary Walls
        tm.x = Math.max(tm.radius, Math.min(MAP_SIZE - tm.radius, tm.x));
        tm.y = Math.max(tm.radius, Math.min(MAP_SIZE - tm.radius, tm.y));
        
        buildings.forEach(b => {
            let cx = Math.max(b.x, Math.min(tm.x, b.x + b.w));
            let cy = Math.max(b.y, Math.min(tm.y, b.y + b.h));
            if (Math.hypot(tm.x - cx, tm.y - cy) < tm.radius) {
                let ang = Math.atan2(tm.y - cy, tm.x - cx);
                tm.x = cx + Math.cos(ang) * tm.radius;
                tm.y = cy + Math.sin(ang) * tm.radius;
            }
        });
    });
}

function processEnemiesBotBrain() {
    enemies.forEach(en => {
        let distToPlayer = Math.hypot(player.x - en.x, player.y - en.y);
        let clearSight = checkLineOfSight(en.x, en.y, player.x, player.y);

        if (distToPlayer < 400 && clearSight) {
            en.state = "ENGAGE"; 
            en.angle = Math.atan2(player.y - en.y, player.x - en.x);
            let enemyInterval = currentMode === "RANKED" ? (700 / difficultyMultiplier) : 750;
            let now = Date.now();
            if (now - en.lastFired > enemyInterval) {
                en.lastFired = now;
                bullets.push({
                    x: en.x + Math.cos(en.angle) * 22, y: en.y + Math.sin(en.angle) * 22,
                    vx: Math.cos(en.angle) * (6.5 * (currentMode === "RANKED" ? Math.min(difficultyMultiplier, 1.4) : 1.0)), 
                    vy: Math.sin(en.angle) * (6.5 * (currentMode === "RANKED" ? Math.min(difficultyMultiplier, 1.4) : 1.0)),
                    radius: 3, owner: "ENEMY", damage: 14, color: "#ff0055"
                });
            }
        } else {
            if (en.state === "ENGAGE") en.state = "PATROL";
            if (Math.random() < 0.02) en.angle = Math.random() * Math.PI * 2;
        }

        if (en.state === "PATROL") {
            let patrolSpeed = 1.5; 
            en.x += Math.cos(en.angle) * patrolSpeed; 
            en.y += Math.sin(en.angle) * patrolSpeed;
        } else {
            if (distToPlayer > 180) {
                let approachSpeed = currentMode === "RANKED" ? (2.2 * difficultyMultiplier) : 2.0;
                en.x += Math.cos(en.angle) * approachSpeed; 
                en.y += Math.sin(en.angle) * approachSpeed;
            }
        }
        en.x = Math.max(en.radius, Math.min(MAP_SIZE - en.radius, en.x));
        en.y = Math.max(en.radius, Math.min(MAP_SIZE - en.radius, en.y));
    });
}

function processEnvironmentFadingEffects() {
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx; p.y += p.vy; p.life -= p.decay;
        if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = deployedShields.length - 1; i >= 0; i--) {
        let s = deployedShields[i]; s.life--;
        if (s.life <= 0 || s.health <= 0) deployedShields.splice(i, 1);
    }
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
        let f = floatingTexts[i]; f.y += f.vy; f.life--;
        f.alpha = f.life / 45;
        if (f.life <= 0) floatingTexts.splice(i, 1);
    }
}

function processInterfaceCooldowns() {
    let now = Date.now();
    ['shield', 'bomb', 'dash'].forEach(key => {
        let cd = cooldowns[key];
        let pct = Math.max(0, 100 - ((now - cd.lastUsed) / cd.duration) * 100);
        document.getElementById(`${key}-cooldown-overlay`).style.height = `${pct}%`;
    });
}

// 📐 GRAPHICS RENDERING MATRIX PIPELINE
function renderEngineGraphics() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();
    
    // INTEGRATION OF INTERFERENCE CAMERA SHAKE VECTOR
    if (camera.shakeIntensity > 0.1) {
        let shakeX = (Math.random() - 0.5) * camera.shakeIntensity;
        let shakeY = (Math.random() - 0.5) * camera.shakeIntensity;
        ctx.translate(shakeX, shakeY);
        camera.shakeIntensity *= camera.shakeDecay;
    }

    camera.x = player.x - (canvas.width / 2) / viewScale;
    camera.y = player.y - (canvas.height / 2) / viewScale;
    camera.x = Math.max(0, Math.min(MAP_SIZE - canvas.width / viewScale, camera.x));
    camera.y = Math.max(0, Math.min(MAP_SIZE - canvas.height / viewScale, camera.y));

    ctx.scale(viewScale, viewScale);
    ctx.translate(-camera.x, -camera.y);

    // Grid Floor
    ctx.strokeStyle = "rgba(0, 246, 255, 0.04)"; ctx.lineWidth = 1;
    let gridSpacer = 100;
    for (let x = 0; x < MAP_SIZE; x += gridSpacer) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, MAP_SIZE); ctx.stroke();
    }
    for (let y = 0; y < MAP_SIZE; y += gridSpacer) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(MAP_SIZE, y); ctx.stroke();
    }
    
    // Safe zone boundary rendering
    if (safeZone.active) {
        ctx.strokeStyle = "rgba(255, 0, 85, 0.7)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(safeZone.x, safeZone.y, safeZone.radius, 0, Math.PI * 2);
        ctx.stroke();
        
        // Out of zone red tint fill filter
        ctx.fillStyle = "rgba(255, 0, 85, 0.05)";
        ctx.beginPath();
        ctx.arc(safeZone.x, safeZone.y, safeZone.radius, 0, Math.PI * 2);
        ctx.rect(MAP_SIZE, 0, -MAP_SIZE, MAP_SIZE);
        ctx.fill();
    }

    // Outer Map Boundaries Lines
    ctx.strokeStyle = "#ff0055"; ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, MAP_SIZE, MAP_SIZE);

    // Draw Obstacles
    obstacles.forEach(o => {
        ctx.fillStyle = "#162238"; ctx.strokeStyle = "#406194"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(o.x, o.y, o.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });

    // Draw Shields
    deployedShields.forEach(s => {
        ctx.strokeStyle = "rgba(0, 255, 204, 0.6)"; ctx.lineWidth = 3;
        ctx.fillStyle = "rgba(0, 255, 204, 0.08)";
        ctx.beginPath(); ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });

    // Projectile Engine Tracers Loop
    bullets.forEach(b => {
        ctx.fillStyle = b.color; ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2); ctx.fill();
    });

    // Glow engine particle layers
    particles.forEach(p => {
        ctx.globalAlpha = p.life; ctx.fillStyle = p.color;
        ctx.beginPath();
        if (p.isTracer) {
            ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
        } else {
            ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        }
        ctx.fill();
    });
    ctx.globalAlpha = 1.0;

    // Draw Teammates
    teammates.forEach(tm => {
        ctx.fillStyle = "#0055ff"; ctx.beginPath(); ctx.arc(tm.x, tm.y, tm.radius, 0, Math.PI * 2); ctx.fill();
    });

    // Draw Enemies (With Fog of War checks)
    enemies.forEach(en => {
        let isVisible = currentMode === "TRAINING" || checkLineOfSight(player.x, player.y, en.x, en.y);
        if (!isVisible) return; // Hidden by line-of-sight vector occlusion

        ctx.save(); ctx.translate(en.x, en.y); ctx.rotate(en.angle);
        ctx.fillStyle = "#ff0055"; ctx.beginPath(); ctx.arc(0, 0, en.radius, 0, Math.PI * 2); ctx.fill();
        // Front Weapon Sight Node
        ctx.fillStyle = "#fff"; ctx.fillRect(10, -4, 15, 8);
        ctx.restore();

        // Enemy Health Slider Track
        ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(en.x - 20, en.y - 28, 40, 4);
        let hpPct = Math.max(0, en.health / en.maxHealth);
        ctx.fillStyle = "#ff0055"; ctx.fillRect(en.x - 20, en.y - 28, 40 * hpPct, 4);
    });

    // Draw Buildings (Occlusion Walls)
    buildings.forEach(b => {
        ctx.fillStyle = b.color; ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = "rgba(0, 246, 255, 0.2)"; ctx.lineWidth = 2; ctx.strokeRect(b.x, b.y, b.w, b.h);
    });

    // Draw Main Player Matrix Engine Target
    ctx.save(); ctx.translate(player.x, player.y); ctx.rotate(player.angle);
    let playerColor = player.dashActive ? "#ffaa00" : "#00f6ff";
    ctx.fillStyle = playerColor; ctx.shadowBlur = 15; ctx.shadowColor = playerColor;
    ctx.beginPath(); ctx.arc(0, 0, player.radius, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0; // Reset
    ctx.fillStyle = "#030814"; ctx.fillRect(12, -5, 14, 10);
    ctx.strokeStyle = playerColor; ctx.lineWidth = 2; ctx.strokeRect(12, -5, 14, 10);
    ctx.restore();

    // Floating Text Engine Renderer
    floatingTexts.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha; ctx.fillStyle = f.color;
        ctx.font = "bold 13px monospace"; ctx.textAlign = "center";
        ctx.fillText(f.text, f.x, f.y); ctx.restore();
    });

    // Touch overlay controllers HUD paths
    if (leftTouch.active) {
        ctx.fillStyle = "rgba(255,255,255,0.04)"; ctx.strokeStyle = "rgba(0,246,255,0.25)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(leftTouch.startX + camera.x, leftTouch.startY + camera.y, 45, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "rgba(0,246,255,0.5)"; ctx.beginPath();
        ctx.arc(leftTouch.currentX + camera.x, leftTouch.currentY + camera.y, 18, 0, Math.PI*2); ctx.fill();
    }
    if (rightTouch.active) {
        ctx.fillStyle = "rgba(255,255,255,0.04)"; ctx.strokeStyle = "rgba(255,0,85,0.25)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(rightTouch.startX + camera.x, rightTouch.startY + camera.y, 45, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    }

    ctx.restore();
}

// MANAGEMENT OF MATCH INTERMISSIONS & STATE LOOPS
function handleIntermissionVictory() {
    gameState = "INTERMISSION_SCREEN";
    document.getElementById('ui-layer').classList.add('hidden');
    document.getElementById('level-complete-screen').classList.remove('hidden');
    
    let bonus = currentMode === "RANKED" ? Math.floor(40 * difficultyMultiplier) : 25;
    rankData.points += bonus;
    document.getElementById('rp-gain-value').innerText = `+${bonus} RP`;
    
    updateRankAndDifficultySystems();
    AudioSynth.play(659, "sine", 0.5, 0.6);
    document.getElementById('victory-rp-summary').innerText = `CURRENT ARCHIVE ACCUMULATION: ${rankData.points} RP`;
}

function handleIntermissionFailure() {
    gameState = "INTERMISSION_SCREEN";
    document.getElementById('ui-layer').classList.add('hidden');
    document.getElementById('level-failed-screen').classList.remove('hidden');
    
    let floorCompensation = currentMode === "RANKED" ? -20 : 5;
    rankData.points = Math.max(0, rankData.points + floorCompensation);
    document.getElementById('rp-loss-value').innerText = floorCompensation >= 0 ? `+${floorCompensation} RP` : `${floorCompensation} RP`;
    
    updateRankAndDifficultySystems();
    AudioSynth.play(147, "sawtooth", 0.6, 0.6);
    document.getElementById('failed-rp-summary').innerText = `CURRENT ARCHIVE ACCUMULATION: ${rankData.points} RP`;
}

// PAUSE CONTROLS & LEAVE PROTECTION MATRICES
document.getElementById('pause-trigger-btn').addEventListener('click', () => {
    if (gameState === "PLAYING") {
        gameState = "PAUSED";
        document.getElementById('pause-menu').classList.remove('hidden');
        AudioSynth.play(330, "sine", 0.15, 0.4);
    }
});

document.getElementById('resume-game-btn').addEventListener('click', () => {
    gameState = "PLAYING";
    document.getElementById('pause-menu').classList.add('hidden');
    AudioSynth.play(440, "sine", 0.15, 0.4);
});

document.getElementById('trigger-quit-warning-btn').addEventListener('click', () => {
    document.getElementById('quit-warning-menu').classList.remove('hidden');
    AudioSynth.play(220, "sawtooth", 0.2, 0.5);
});

document.getElementById('confirm-quit-no-btn').addEventListener('click', () => {
    document.getElementById('quit-warning-menu').classList.add('hidden');
    AudioSynth.play(440, "sine", 0.1, 0.4);
});

document.getElementById('confirm-quit-yes-btn').addEventListener('click', () => {
    // LEAVE MATCH PENALTY DOCKING
    if (currentMode === "RANKED") {
        rankData.points = Math.max(0, rankData.points - 25);
    }
    updateRankAndDifficultySystems();
    
    document.getElementById('quit-warning-menu').classList.add('hidden');
    document.getElementById('pause-menu').classList.add('hidden');
    document.getElementById('ui-layer').classList.add('hidden');
    document.getElementById('start-menu').classList.remove('hidden');
    gameState = "MENU";
});

document.getElementById('next-level-btn').addEventListener('click', returnToHubFromIntermission);
document.getElementById('fail-home-btn').addEventListener('click', returnToHubFromIntermission);

function returnToHubFromIntermission() {
    document.getElementById('level-complete-screen').classList.add('hidden');
    document.getElementById('level-failed-screen').classList.add('hidden');
    document.getElementById('start-menu').classList.remove('hidden');
    gameState = "MENU";
    updateRankAndDifficultySystems();
}

// MODE BUTTONS SELECTORS TABS GRID
const modeCards = document.querySelectorAll('.mode-card');
modeCards.forEach(card => {
    card.addEventListener('click', () => {
        modeCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        currentMode = card.getAttribute('data-mode');
        AudioSynth.play(523, "sine", 0.08, 0.4);
        updateRankAndDifficultySystems();
    });
});

// HUD SIDE CONFIGURATION TAB LAYOUT HANDLERS
const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabPanels.forEach(p => p.classList.add('hidden'));
        btn.classList.add('active');
        document.getElementById(`tab-${btn.getAttribute('data-tab')}`).classList.remove('hidden');
        AudioSynth.play(698, "sine", 0.05, 0.3);
    });
});

// SETTINGS ASSIGNMENT RELAYS
document.getElementById('setting-graphics').addEventListener('change', (e) => { settings.graphics = e.target.value; });
document.getElementById('setting-particles').addEventListener('change', (e) => { settings.particles = e.target.value; });
document.getElementById('slider-vol-master').addEventListener('input', (e) => { settings.volMaster = e.target.value / 100; });
document.getElementById('slider-vol-sfx').addEventListener('input', (e) => { 
    settings.volSfx = e.target.value / 100; 
    document.getElementById('pause-slider-sfx').value = e.target.value;
});
document.getElementById('pause-slider-sfx').addEventListener('input', (e) => {
    settings.volSfx = e.target.value / 100;
    document.getElementById('slider-vol-sfx').value = e.target.value;
});
document.getElementById('slider-sens-move').addEventListener('input', (e) => { settings.sensMove = e.target.value / 100; });
document.getElementById('slider-sens-look').addEventListener('input', (e) => { 
    settings.sensLook = e.target.value / 100; 
    document.getElementById('pause-slider-sens').value = e.target.value;
});
document.getElementById('pause-slider-sens').addEventListener('input', (e) => {
    settings.sensLook = e.target.value / 100;
    document.getElementById('slider-sens-look').value = e.target.value;
});

// START EVENT LOOP RUNTIME TICS
requestAnimationFrame(gameTick);