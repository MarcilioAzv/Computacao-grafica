import * as THREE from 'three';
import { OBJLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { iniciarInterface } from './interface.js';
import { Sky } from 'https://unpkg.com/three@0.160.0/examples/jsm/objects/Sky.js';

// ─── Variáveis Globais ────────────────────────────────────────────────────────
let scene, camera, renderer;
let projectile;
let pistol;
let isFiring   = false;
let isLoaded   = false;
let hasBounced = false;
let mixer;
let shootAction;
let cameraTarget = "pistol";
let fireSound;

// Variáveis de controle do mouse (FPS look)
let yaw = 0;
let pitch = 0;
const sensitivity = 0.002;
const clock = new THREE.Clock();

// ─── Configuração da Simulação ────────────────────────────────────────────────
const config = {
    v0: 100,
    angle: 0,
    gravity: 9.81,
    wind: 0,
    startX: 0,
    startY: 5,
};

// ─── Sistema de Física Matemática (sem Cannon.js) ─────────────────────────────
const bulletState = {
    active: false,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    time: 0,
    bounced: false,
    bounceCount: 0,
};

// ─── Sistema de Chunks (Grade 2D Infinita) ────────────────────────────────────
const CHUNK_SIZE  = 100; // Tamanho do bloco
const VIEW_RADIUS = 3;   // Raio de visão (3 blocos = grade de 7x7)

const modelTemplates = {
    ground: null,
    plant:  null,
    rock:   null,
    tree:   null,
};

let activeChunks = [];

// ─── PRÉ-CARREGAMENTO DOS MODELOS ─────────────────────────────────────────────
function preloadModels() {
    const loader = new GLTFLoader();
   const modelDefs = [
        { key: 'ground', path: './assets/models/ground_grass.glb' },
        { key: 'plant',  path: './assets/models/plant_flatShort.glb' }, // Confirme se o nome do arquivo é esse mesmo!
        { key: 'rock',   path: './assets/models/rock_largeB.glb' },      // Confirme se o nome do arquivo é esse mesmo!
        { key: 'tree',   path: './assets/models/tree_thin.glb' },
    ];
    const promises = modelDefs.map(({ key, path }) =>
        new Promise((resolve) => {
            loader.load(
                path,
                (gltf) => {
                    modelTemplates[key] = gltf.scene;
                    console.log(`[Chunks] Modelo carregado: ${key}`);
                    resolve();
                },
                undefined,
                (err) => {
                    console.error(`[Chunks] Arquivo não encontrado: ${path}. Usaremos fallback visual.`);
                    resolve(); 
                }
            );
        })
    );

    return Promise.all(promises);
}

// ─── CONSTRUTOR DE CHUNK ──────────────────────────────────────────────────────
function buildChunk(chunkX, chunkZ) {
    const group = new THREE.Group();
    
    const worldX = chunkX * CHUNK_SIZE;
    const worldZ = chunkZ * CHUNK_SIZE;
    group.position.set(worldX, 0, worldZ);

    if (modelTemplates.ground) {
        const groundClone = modelTemplates.ground.clone(true);
        const box = new THREE.Box3().setFromObject(groundClone);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);

        // Alinha o topo do modelo perfeitamente com o Y = 0
        groundClone.position.set(-center.x, -box.max.y, -center.z);

        const scaleContainer = new THREE.Group();
        scaleContainer.add(groundClone);

        // Estica o modelo para preencher o bloco perfeitamente
        const sX = size.x > 0.1 ? CHUNK_SIZE / size.x : 1;
        const sZ = size.z > 0.1 ? CHUNK_SIZE / size.z : 1;
        scaleContainer.scale.set(sX, 1, sZ);

        group.add(scaleContainer);
    } else {
        // Fallback caso a grama falhe
        const fallbackMat = new THREE.MeshStandardMaterial({ color: 0x3d8c40 });
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE), fallbackMat);
        plane.rotation.x = -Math.PI / 2;
        group.add(plane);
    }

    seedDecorations(group);
    
    // Guardamos as duas coordenadas
    group.userData = { x: chunkX, z: chunkZ };

    return group;
}

function seedDecorations(chunkGroup) {
    const half = (CHUNK_SIZE / 2) - 10;

    const decorDefs = [
        { key: 'plant', count: 8, scaleRange: [5.0, 10.0] },
        { key: 'rock',  count: 3, scaleRange: [2.5, 5.0] },
        { key: 'tree',  count: 4, scaleRange: [15.0, 30.0] },
    ];

    for (const { key, count, scaleRange } of decorDefs) {
        if (!modelTemplates[key]) continue;

        for (let i = 0; i < count; i++) {
            const clone = modelTemplates[key].clone(true);

            const localX = (Math.random() * 2 - 1) * half;
            const localZ = (Math.random() * 2 - 1) * half;
            const rotY = Math.random() * Math.PI * 2;
            const scale = scaleRange[0] + Math.random() * (scaleRange[1] - scaleRange[0]);

            clone.position.set(localX, 0, localZ); 
            clone.rotation.y = rotY;
            clone.scale.setScalar(scale);

            chunkGroup.add(clone);
        }
    }
}

// ─── ESTEIRA INFINITA MAGNÉTICA ───────────────────────────────────────────────
function spawnChunk(chunkX, chunkZ) {
    const chunk = buildChunk(chunkX, chunkZ);
    scene.add(chunk);
    activeChunks.push(chunk);
}

function updateChunks() {
    const camX = Math.floor(camera.position.x / CHUNK_SIZE);
    const camZ = Math.floor(camera.position.z / CHUNK_SIZE);

    // 1. Limpa os blocos que ficaram muito longe
    for (let i = activeChunks.length - 1; i >= 0; i--) {
        const chunk = activeChunks[i];
        const distX = Math.abs(chunk.userData.x - camX);
        const distZ = Math.abs(chunk.userData.z - camZ);
        
        if (distX > VIEW_RADIUS || distZ > VIEW_RADIUS) {
            scene.remove(chunk);
            chunk.traverse((child) => {
                if (child.isMesh) {
                    child.geometry?.dispose();
                    if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                    else child.material?.dispose();
                }
            });
            activeChunks.splice(i, 1);
        }
    }

    // 2. Cria blocos ao redor em um formato de grade
    for (let x = -VIEW_RADIUS; x <= VIEW_RADIUS; x++) {
        for (let z = -VIEW_RADIUS; z <= VIEW_RADIUS; z++) {
            const targetX = camX + x;
            const targetZ = camZ + z;
            
            const exists = activeChunks.some(c => c.userData.x === targetX && c.userData.z === targetZ);
            if (!exists) {
                spawnChunk(targetX, targetZ);
            }
        }
    }
}

// ─── FÍSICA MATEMÁTICA DA BALA ────────────────────────────────────────────────
function fireBullet(spawnPos, direction) {
    bulletState.active   = true;
    bulletState.bounced  = false;
    bulletState.bounceCount = 0;
    bulletState.time     = 0;
    bulletState.position.copy(spawnPos);
    bulletState.velocity.copy(direction).multiplyScalar(config.v0);

    hasBounced = false;
    projectile.visible = true;
    projectile.position.copy(spawnPos);
}

function updateBullet(delta) {
    if (!bulletState.active || !projectile) return;

    bulletState.time += delta;
    bulletState.velocity.y -= config.gravity * delta;
    bulletState.velocity.x += config.wind * delta;
    bulletState.position.addScaledVector(bulletState.velocity, delta);

    if (bulletState.position.y <= 0) {
        bulletState.position.y = 0;

        if (!hasBounced) {
            hasBounced = true;
            bulletState.bounced = true;
        }

        const restitution = 0.45;
        const friction    = 0.92;

        bulletState.velocity.y    = Math.abs(bulletState.velocity.y) * restitution;
        bulletState.velocity.x   *= friction;
        bulletState.velocity.z   *= friction;
        bulletState.bounceCount++;

        if (bulletState.velocity.y < 0.5 && bulletState.bounceCount > 2) {
            bulletState.velocity.set(0, 0, 0);
            bulletState.active = false;

            setTimeout(() => {
                isFiring = false;
                cameraTarget = "pistol";
                camera.attach(pistol);
                pistol.position.set(2, -4, -2);
                pistol.rotation.set(0, 0, 0);
            }, 1000);
        }
    }

    projectile.position.copy(bulletState.position);

    if (bulletState.velocity.lengthSq() > 0.01) {
        const tempLooker = new THREE.Object3D();
        tempLooker.position.copy(bulletState.position);
        tempLooker.lookAt(bulletState.position.clone().add(bulletState.velocity));
        tempLooker.rotateY(-Math.PI / 2);
        projectile.quaternion.copy(tempLooker.quaternion);
    }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
// ─── INIT ─────────────────────────────────────────────────────────────────────
// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
    scene = new THREE.Scene();

    // ─── NOVO CÉU E SOL PROCEDURAL ────────────────────────────────────────
    const sky = new Sky();
    sky.scale.setScalar(450000); 
    scene.add(sky);

    const sunVector = new THREE.Vector3();

    const skyUniforms = sky.material.uniforms;
    skyUniforms['turbidity'].value = 10;
    skyUniforms['rayleigh'].value = 2;
    skyUniforms['mieCoefficient'].value = 0.005;
    skyUniforms['mieDirectionalG'].value = 0.8;

    // Levantamos o sol e giramos para ele iluminar a FRENTE e o LADO das árvores
    const elevation = 35; 
    const azimuth = -45;  

    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    sunVector.setFromSphericalCoords(1, phi, theta);

    sky.material.uniforms['sunPosition'].value.copy(sunVector);

    // Luz do sol projetando sombras
    const sunLight = new THREE.DirectionalLight(0xffffff, 2.0);
    sunLight.position.copy(sunVector).multiplyScalar(100); 
    sunLight.castShadow = true;
    scene.add(sunLight);
    
    // ─── CÂMERA E ÁUDIO ───────────────────────────────────────────────────
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
    camera.rotation.order = 'YXZ';
    camera.position.set(config.startX, config.startY, 10);

    const listener = new THREE.AudioListener();
    camera.add(listener);
    fireSound = new THREE.Audio(listener);
    const audioLoader = new THREE.AudioLoader();
    audioLoader.load('./assets/tiro.mp3', (buffer) => {
        fireSound.setBuffer(buffer);
        fireSound.setVolume(0.5);
    });

    // ─── RENDERIZADOR (COM LENTE DE FILTRO HDR) ───────────────────────────
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    
    // A MÁGICA ACONTECE AQUI: Controla a super-exposição do sol
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.5; // Ajuste para mais claro ou mais escuro
    
    document.body.appendChild(renderer.domElement);

    // Luz suave para preencher os cantos escuros das folhas e pedras
    scene.add(new THREE.AmbientLight(0xffffff, 1.5)); 

    // Uma névoa exponencial que só começa a agir bem longe, no horizonte
    scene.fog = new THREE.FogExp2(0x87ceeb, 0.0015); 

    console.log('[Chunks] Iniciando downloads...');
    await preloadModels();
    
    updateChunks();

    loadPistol();
    loadProjectile();
    animate();
}

// ─── CARREGAMENTO DA PISTOLA ──────────────────────────────────────────────────
function loadPistol() {
    const gltfLoader  = new GLTFLoader();
    const texLoader   = new THREE.TextureLoader();
    const texPath     = './assets/source/';

    const colorMap    = texLoader.load(texPath + 'berettaColor.png');
    colorMap.colorSpace = THREE.SRGBColorSpace;
    const normalMap   = texLoader.load(texPath + 'berettaNormal.png');
    const roughMap    = texLoader.load(texPath + 'berettaRoughness.png');
    const metalMap    = texLoader.load(texPath + 'berettaMetallic.png');
    const aoMap       = texLoader.load(texPath + 'berettaAO.png');

    const armsColor   = texLoader.load(texPath + 'armsColor.png');
    armsColor.colorSpace = THREE.SRGBColorSpace;
    const armsNormal  = texLoader.load(texPath + 'armsNormal.png');
    const armsRough   = texLoader.load(texPath + 'armsRoughness.png');
    const armsAO      = texLoader.load(texPath + 'armsAO.png');

    gltfLoader.load(texPath + 'pistola.glb', (gltf) => {
        const object = gltf.scene;
        const box    = new THREE.Box3().setFromObject(object);
        object.position.sub(box.getCenter(new THREE.Vector3()));

        object.traverse((child) => {
            if (!child.isMesh) return;
            if (child.geometry.attributes.uv) {
                child.geometry.setAttribute('uv2',
                    new THREE.BufferAttribute(child.geometry.attributes.uv.array, 2));
            }

            const name = child.name.toLowerCase();
            child.material = (name.includes('arms') || name.includes('braço'))
                ? new THREE.MeshStandardMaterial({
                    map: armsColor, normalMap: armsNormal, roughnessMap: armsRough,
                    aoMap: armsAO, aoMapIntensity: 1, metalness: 0, side: THREE.DoubleSide
                  })
                : new THREE.MeshStandardMaterial({
                    map: colorMap, normalMap, roughnessMap: roughMap,
                    metalnessMap: metalMap, aoMap, aoMapIntensity: 1, side: THREE.DoubleSide
                  });

            child.raycast = () => {};
        });

        object.rotation.y = Math.PI;

        if (gltf.animations?.length > 0) {
            mixer = new THREE.AnimationMixer(object);
            const clip    = THREE.AnimationUtils.subclip(gltf.animations[0], 'Atirar', 0, 13, 30);
            shootAction   = mixer.clipAction(clip);
            shootAction.setLoop(THREE.LoopOnce);
            shootAction.clampWhenFinished = true;
        }

        pistol = new THREE.Group();
        pistol.add(object);
        pistol.scale.set(0.25, 0.25, 0.25);
        pistol.position.set(2, -4, -2);
        camera.add(pistol);
        scene.add(camera);
    });
}

// ─── CARREGAMENTO DO PROJÉTIL ─────────────────────────────────────────────────
function loadProjectile() {
    const texLoader = new THREE.TextureLoader();
    texLoader.load('./assets/45/tex_2/dirt_texture.jpg', (colorTex) => {
        colorTex.colorSpace = THREE.SRGBColorSpace;
        const scratchTex = texLoader.load('./assets/45/tex_2/metal_scratches.jpg');

        const objLoader = new OBJLoader();
        objLoader.setPath('./assets/45/');
        objLoader.load('45.obj', (object) => {
            const box = new THREE.Box3().setFromObject(object);
            object.position.sub(box.getCenter(new THREE.Vector3()));

            object.traverse((child) => {
                if (child.isMesh) {
                    child.material = new THREE.MeshStandardMaterial({
                        map: colorTex, color: 0xffffff,
                        metalness: 0.3, roughness: 0.4, roughnessMap: scratchTex,
                    });
                }
            });

            object.rotation.z = -Math.PI / 2;

            projectile = new THREE.Group();
            projectile.add(object);
            projectile.visible = false;
            scene.add(projectile);

            isLoaded = true;
        });
    });
}

// ─── LOOP DE ANIMAÇÃO ─────────────────────────────────────────────────────────
function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    if (mixer) mixer.update(delta);
    
    updateBullet(delta);
    updateChunks();

    const crosshair = document.getElementById('crosshair');

    if (cameraTarget === "pistol") {
        if (pistol)    pistol.visible = true;
        if (crosshair) crosshair.style.visibility = 'visible';

        camera.position.set(config.startX, config.startY, camera.position.z);
        camera.rotation.set(pitch, yaw, 0, 'YXZ');
    }
    else if (cameraTarget === "bullet" && projectile) {
        if (pistol)    pistol.visible = true;
        if (crosshair) crosshair.style.visibility = 'hidden';

        const bulletOffset    = new THREE.Vector3(10, 1, 0);
        const targetCameraPos = projectile.position.clone().add(bulletOffset);
        camera.position.lerp(targetCameraPos, 0.1);
        camera.lookAt(projectile.position);
    }

    renderer.render(scene, camera);
}

// ─── EVENTOS DE CONTROLE ──────────────────────────────────────────────────────
document.addEventListener('click', (e) => {
    if (e.target.closest('.lil-gui')) return;
    if (cameraTarget === "pistol") renderer.domElement.requestPointerLock();
});

document.addEventListener('mousemove', (e) => {
    if (e.target.closest('.lil-gui')) return;
    if (document.pointerLockElement === renderer.domElement && cameraTarget === "pistol" && !isFiring) {
        yaw   -= e.movementX * sensitivity;
        pitch -= e.movementY * sensitivity;
        pitch  = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, pitch));
        config.angle = parseFloat((pitch * (180 / Math.PI)).toFixed(1));
    }
});

window.addEventListener('mousedown', (e) => {
    if (e.target.closest('.lil-gui')) return;
    if (document.pointerLockElement !== renderer.domElement) {
        renderer.domElement.requestPointerLock();
        return;
    }

    if (e.button !== 0 || !isLoaded || isFiring || !pistol || !projectile) return;

    isFiring   = true;
    hasBounced = false;

    const barrelOffset = new THREE.Vector3(-2, 13.3, -30);
    const spawnPos     = barrelOffset.clone();
    pistol.localToWorld(spawnPos);

    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    direction.x += (Math.random() - 0.5) * 0.015;
    direction.y += (Math.random() - 0.5) * 0.015;
    direction.z += (Math.random() - 0.5) * 0.015;
    direction.normalize();

    fireBullet(spawnPos, direction);

    if (shootAction) shootAction.stop().play();
    if (fireSound?.buffer) {
        if (fireSound.isPlaying) fireSound.stop();
        fireSound.play();
    }

    setTimeout(() => {
        cameraTarget = "bullet";
        scene.attach(pistol);
    }, 100);
});

window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── INICIA TUDO ─────────────────────────────────────────────────────────────
init();

iniciarInterface(config, null, (modo) => {
    if (modo === 'LIVRE') {
        cameraTarget = "none";
        document.exitPointerLock();
    } else {
        cameraTarget = "pistol";
    }
});

window.forcarResetDaCena = function() {
    // 1. Cancela timers pendentes
    if (window.returnTimer) { 
        clearTimeout(window.returnTimer); 
        window.returnTimer = null; 
    }

    // 2. Reseta o estado interno
    isFiring = false;
    hasBounced = false;
    cameraTarget = "pistol"; 

    // 3. Resgata a arma
    if (typeof pistol !== 'undefined' && pistol && camera) {
        camera.attach(pistol); 
        pistol.position.set(2, -4, -2); 
        pistol.rotation.set(0, 0, 0); 
    }

    // 4. Limpa a bala física
    if (typeof projectileBody !== 'undefined' && projectileBody && projectile) {
        projectileBody.sleep();
        projectileBody.position.set(0, -100, 0); 
        projectileBody.velocity.set(0, 0, 0);
        projectileBody.angularVelocity.set(0, 0, 0);
        projectile.visible = false;
    }

    // 5. Centraliza a visão
    if (camera) {
        camera.position.set(config.startX, config.startY, 10);
        pitch = 0; 
    }
};

// Função para a interface inclinar a arma
window.atualizarPitchPelaInterface = function(anguloEmGraus) {
    if (!isFiring) { // Só permite mexer se não tiver atirado ainda
        // Converte os graus do painel (ex: 45) para radianos, que é o que o Three.js usa
        pitch = anguloEmGraus * (Math.PI / 180); 
    }
};
