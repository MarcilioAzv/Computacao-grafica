import * as THREE from 'three';
import { OBJLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/OBJLoader.js';
import * as CANNON from 'https://unpkg.com/cannon-es@0.20.0/dist/cannon-es.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { iniciarInterface } from './interface.js';


// ─── Variáveis Globais ────────────────────────────────────────────────────────
let scene, camera, renderer;
let projectile, projectileBody;
let world, groundBody;
let physicsMaterial;
let pistol;
let isFiring   = false;
let isLoaded   = false;
let hasBounced = false;
let mixer;
let shootAction;
let cameraTarget = "pistol";
let fireSound;
const flightQuaternion = new THREE.Quaternion(); 

// Variáveis para controle do mouse (olhar)
let yaw = 0;
let pitch = 0;
const sensitivity = 0.002;
const clock = new THREE.Clock();

const config = {
    v0: 100,
    angle: 0, 
    gravity: 9.81,
    wind: 0,
    startX: -40,
    startY: 5, 
};

// ─── INIT ─────────────────────────────────────────────────────────────────────
function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.rotation.order = 'YXZ';
    camera.position.set(config.startX, config.startY, 10);
    const listener = new THREE.AudioListener();
    camera.add(listener);

    // Cria o tocador de som
    fireSound = new THREE.Audio(listener);
    const audioLoader = new THREE.AudioLoader();
    audioLoader.load('./assets/tiro.mp3', (buffer) => {
        fireSound.setBuffer(buffer);
        fireSound.setVolume(0.5);
    });

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(config.startX, config.startY, 5); 
    controls.update();

    scene.add(new THREE.DirectionalLight(0xffffff, 1).position.set(5, 10, 7.5) && new THREE.DirectionalLight(0xffffff, 1));
    scene.add(new THREE.AmbientLight(0xffffff, 1.5));

    const textureLoader = new THREE.TextureLoader();
    const colorMap = textureLoader.load('./assets/1K/Poliigon_GrassPatchyGround_4585_BaseColor.jpg'); 
    const normalMap = textureLoader.load('./assets/1K/Poliigon_GrassPatchyGround_4585_Normal.png');
    const roughnessMap = textureLoader.load('./assets/1K/Poliigon_GrassPatchyGround_4585_Normal.png');
    const aoMap = textureLoader.load('./assets/1K/Poliigon_GrassPatchyGround_4585_AmbientOcclusion.jpg');

    // Configura todas as texturas para se repetirem pelo mapa
    [colorMap, normalMap, roughnessMap, aoMap].forEach(tex => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(200, 200); // Ajusta o tamanho do ladrilho da grama
    });
    
    colorMap.colorSpace = THREE.SRGBColorSpace;

    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(2000, 2000),
        new THREE.MeshStandardMaterial({
            map: colorMap,
            normalMap: normalMap,
            roughnessMap: roughnessMap,
            aoMap: aoMap,
            aoMapIntensity: 1.0 // Intensidade das sombras entre as folhas
        })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    world = new CANNON.World({ gravity: new CANNON.Vec3(0, -config.gravity, 0) });
    world.allowSleep = true;

    physicsMaterial = new CANNON.Material('standard');
    world.addContactMaterial(new CANNON.ContactMaterial(
        physicsMaterial, physicsMaterial, { friction: 0.05, restitution: 0.6 }
    ));

    groundBody = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape: new CANNON.Plane(),
        material: physicsMaterial,
    });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(groundBody);

    loadModel();  
    loadPistol(); 
    animate();
}

function loadPistol() {
    console.log("Iniciando carregamento da pistola..."); 
    const gltfLoader = new GLTFLoader();
    const textureLoader = new THREE.TextureLoader();
    const texPath = './assets/source/';

    const colorMap = textureLoader.load(texPath + 'berettaColor.png');
    colorMap.colorSpace = THREE.SRGBColorSpace;
    const normalMap = textureLoader.load(texPath + 'berettaNormal.png');
    const roughnessMap = textureLoader.load(texPath + 'berettaRoughness.png');
    const metallicMap = textureLoader.load(texPath + 'berettaMetallic.png');
    const aoMap = textureLoader.load(texPath + 'berettaAO.png');

    const armsColorMap = textureLoader.load(texPath + 'armsColor.png');
    armsColorMap.colorSpace = THREE.SRGBColorSpace;
    const armsNormalMap = textureLoader.load(texPath + 'armsNormal.png');
    const armsRoughnessMap = textureLoader.load(texPath + 'armsRoughness.png');
    const armsAOMap = textureLoader.load(texPath + 'armsAO.png');

    gltfLoader.load(texPath + 'pistola.glb', (gltf) => {
        const object = gltf.scene;
        const box = new THREE.Box3().setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        object.position.sub(center);

        object.traverse((child) => {
            if (child.isMesh) {
                if (child.geometry.attributes.uv) {
                    child.geometry.setAttribute('uv2', new THREE.BufferAttribute(child.geometry.attributes.uv.array, 2));
                }
                const meshName = child.name.toLowerCase();
                if (meshName.includes("arms") || meshName.includes("braço")) {
                    child.material = new THREE.MeshStandardMaterial({
                        map: armsColorMap, normalMap: armsNormalMap, roughnessMap: armsRoughnessMap,
                        aoMap: armsAOMap, aoMapIntensity: 1.0, metalness: 0.0, side: THREE.DoubleSide
                    });
                } else {
                    child.material = new THREE.MeshStandardMaterial({
                        map: colorMap, normalMap: normalMap, roughnessMap: roughnessMap,
                        metalnessMap: metallicMap, aoMap: aoMap, aoMapIntensity: 1.0, side: THREE.DoubleSide
                    });
                }
                child.raycast = () => {}; 
            }
        });

        object.rotation.y = Math.PI; 

        if (gltf.animations && gltf.animations.length > 0) {
            mixer = new THREE.AnimationMixer(object);
            const shootClip = THREE.AnimationUtils.subclip(gltf.animations[0], 'Atirar', 0, 13, 30);
            shootAction = mixer.clipAction(shootClip);
            shootAction.setLoop(THREE.LoopOnce);
            shootAction.clampWhenFinished = true;
        }

        pistol = new THREE.Group();
        pistol.add(object);
        pistol.scale.set(0.25, 0.25, 0.25);
        
        // Arma de volta para o ombro/câmera
        pistol.position.set(2, -4, -2); 
        camera.add(pistol);
        scene.add(camera); 
    });
}

function loadModel() {
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load('./assets/45/tex_2/dirt_texture.jpg', (colorTexture) => {
        colorTexture.colorSpace = THREE.SRGBColorSpace;
        const scratchTexture = textureLoader.load('./assets/45/tex_2/metal_scratches.jpg');
        const objLoader = new OBJLoader();
        objLoader.setPath('./assets/45/');

        objLoader.load('45.obj', (object) => {
            const box = new THREE.Box3().setFromObject(object);
            const center = box.getCenter(new THREE.Vector3());
            object.position.sub(center);

            object.traverse((child) => {
                if (child.isMesh) {
                    child.material = new THREE.MeshStandardMaterial({
                        map: colorTexture, color: 0xffffff, metalness: 0.3,
                        roughness: 0.4, roughnessMap: scratchTexture,
                    });
                }
            });

            object.rotation.z = -Math.PI / 2;
            projectile = new THREE.Group();
            projectile.add(object);
            projectile.visible = false;
            scene.add(projectile);

            projectileBody = new CANNON.Body({
                mass: 1,
                shape: new CANNON.Box(new CANNON.Vec3(1.25, 0.4, 0.4)),
                material: physicsMaterial,
                linearDamping: 0.1,
                angularDamping: 0.5,
                fixedRotation: true,
            });
            world.addBody(projectileBody);

            projectileBody.addEventListener('collide', (e) => {
                if (e.body === groundBody && !hasBounced) {
                    hasBounced = true;
                    projectileBody.fixedRotation = false;
                    projectileBody.updateMassProperties();
                }
            });
            isLoaded = true;
            console.log("Bala carregada.");
        });
    });
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    world.step(1 / 60, delta, 3);

    if (projectile && projectileBody) {
        projectile.position.copy(projectileBody.position);
        if (!hasBounced) {
            // Pega a direção exata para onde a bala está caindo/voando agora
            const velocityVector = new THREE.Vector3(
                projectileBody.velocity.x,
                projectileBody.velocity.y,
                projectileBody.velocity.z
            );
            
            // Se estiver se movendo, alinha a bala com essa direção
            if (velocityVector.lengthSq() > 0.1) {
                const tempLooker = new THREE.Object3D();
                tempLooker.position.copy(projectile.position);
                tempLooker.lookAt(projectile.position.clone().add(velocityVector));
                tempLooker.rotateY(-Math.PI / 2); // Mantém a correção pro modelo não ir de lado

                projectile.quaternion.copy(tempLooker.quaternion);
                projectileBody.quaternion.copy(tempLooker.quaternion);
            }
        } else {
            projectile.quaternion.copy(projectileBody.quaternion);
        }
    }

    if (mixer) mixer.update(delta);

    const crosshair = document.getElementById('crosshair');

    if (cameraTarget === "pistol") {
        if (pistol) pistol.visible = true;
        if (crosshair) crosshair.style.visibility = 'visible';
        
        camera.position.set(config.startX, config.startY, 10);
        camera.rotation.set(pitch, yaw, 0, 'YXZ');
    } 
    else if (cameraTarget === "bullet" && projectile) {
        if (pistol) pistol.visible = true; 
        if (crosshair) crosshair.style.visibility = 'hidden';

        const bulletOffset = new THREE.Vector3(10, 1, 0); 
        const targetCameraPos = projectile.position.clone().add(bulletOffset);
        camera.position.lerp(targetCameraPos, 0.1);
        
        camera.lookAt(projectile.position);
        camera.position.lerp(projectile.position.clone().add(bulletOffset), 0.1);
        camera.lookAt(projectile.position);

        const speed = projectileBody.velocity.length();
        if ((speed < 0.2 && hasBounced) || projectileBody.position.y < -10) {
            if (!window.returnTimer) {
                window.returnTimer = setTimeout(() => {
                    isFiring = false;
                    cameraTarget = "pistol";
                    
                    // Pega a arma de volta pro FPS quando acabar
                    camera.attach(pistol); 
                    pistol.position.set(2, -4, -2); 
                    pistol.rotation.set(0, 0, 0); 
                    
                    window.returnTimer = null;
                }, 1000);
            }
        }
    }
    renderer.render(scene, camera);
}

// ─── EVENTOS DE CONTROLE ─────────────────────────────────────────────────────

document.addEventListener('click', (e) => {
    if (e.target.closest('.lil-gui')) return;
    if (cameraTarget === "pistol") renderer.domElement.requestPointerLock();
});

document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === renderer.domElement && cameraTarget === "pistol" && !isFiring) {
        
        pitch -= e.movementY * sensitivity;
        
        // ==========================================
        // A NOVA TRAVA: Exatamente 45 graus (em radianos)
        const limiteRadianosmin = 60 * (Math.PI / 180);
        const limiteRadianosmax = 20 * (Math.PI / 180); // Converte 45° para radianos
        pitch = Math.max(-limiteRadianosmax, Math.min(limiteRadianosmin, pitch));
        // ==========================================
        
        // Pega o radiano da arma, transforma em graus e injeta no painel
        config.angle = parseFloat((pitch * (180 / Math.PI)).toFixed(1));
    }
});

window.addEventListener('mousedown', (e) => {
    if (e.target.closest('.lil-gui')) return;
    if (document.pointerLockElement !== renderer.domElement) {
        renderer.domElement.requestPointerLock();
        return;
    }

    if (e.button === 0 && isLoaded && !isFiring && pistol && projectileBody) {
        if (window.returnTimer) { clearTimeout(window.returnTimer); window.returnTimer = null; }

        isFiring = true;
        hasBounced = false;
        
        projectile.visible = true;
        projectileBody.wakeUp();
        projectileBody.fixedRotation = true; 

        // Offset do seu cano
        const barrelTipOffset = new THREE.Vector3(-2, 13.3, -30); 
        const spawnPosition = barrelTipOffset.clone();
        pistol.localToWorld(spawnPosition); 

        projectileBody.position.copy(spawnPosition);
        
       projectileBody.velocity.set(0, 0, 0);
        
        // Dá um "peteco" giratório aleatório na bala. Faz cada quique no chão ser único.
        projectileBody.angularVelocity.set(
            (Math.random() - 0.5) * 5, 
            (Math.random() - 0.5) * 5, 
            (Math.random() - 0.5) * 5
        );

        const direction = new THREE.Vector3();
        camera.getWorldDirection(direction);

        // Injeta uma micro-imperfeição na mira (spread). A bala nunca cai no mesmo X/Z.
        direction.x += (Math.random() - 0.5) * 0.015;
        direction.y += (Math.random() - 0.5) * 0.015;
        direction.z += (Math.random() - 0.5) * 0.015;
        direction.normalize();

        projectileBody.velocity.set(
            direction.x * config.v0,
            direction.y * config.v0,
            direction.z * config.v0
        );

        const tempLooker = new THREE.Object3D();
        tempLooker.lookAt(direction); 
        tempLooker.rotateY(-Math.PI / 2);    

        flightQuaternion.copy(tempLooker.quaternion);
        projectileBody.quaternion.copy(flightQuaternion);
        projectile.quaternion.copy(flightQuaternion);

        if (shootAction) { shootAction.stop().play(); }
        if (fireSound && fireSound.buffer) {
            if (fireSound.isPlaying) fireSound.stop(); // Corta o som anterior se atirar rápido
            fireSound.play();
        }
        // Atraso de 100ms e desgruda a arma
        setTimeout(() => {
            cameraTarget = "bullet";
            scene.attach(pistol); 
        }, 100);
    }
});

window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

init();

iniciarInterface(config, world, (modo) => {
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