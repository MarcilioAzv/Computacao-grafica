import * as THREE from "three";
import { OBJLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/OBJLoader.js";
import * as CANNON from "https://unpkg.com/cannon-es@0.20.0/dist/cannon-es.js";
import { GLTFLoader } from "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js";
import { Sky } from "https://unpkg.com/three@0.160.0/examples/jsm/objects/Sky.js";
import { iniciarInterface } from "./interface.js";
import { MTLLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/MTLLoader.js';

// ─── Variáveis Globais ────────────────────────────────────────────────────────
let scene, camera, renderer;
let projectile, projectileBody;
let world, groundBody;
let physicsMaterial;
let pistol;
let isFiring = false;
let isLoaded = false;
let hasBounced = false;
let mixer;
let shootAction;
let cameraTarget = "pistol";
let fireSound;
let trajectorySamples = [];
let trajectoryTimer = 0;
let hitAlvo = false;
let bulletYaw = 0;
let bulletPitch = 0;
const bulletRadius = 5;

const flightQuaternion = new THREE.Quaternion();

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

// ─── SISTEMA PROCEDURAL (DO PRIMEIRO CÓDIGO) ─────────────────────────────────

const CHUNK_SIZE = 100;
const VIEW_RADIUS = 3;

const modelTemplates = {
  ground: null,
  plant: null,
  rock: null,
  tree: null,
};

let activeChunks = [];

const textureLoader = new THREE.TextureLoader();

const pathColorMap = textureLoader.load('./assets/path/GroundDirtWeedsPatchy004_COL_1K.jpg');
const pathNormalMap = textureLoader.load('./assets/path/GroundDirtWeedsPatchy004_NRM_1K.jpg');
const pathAOMap = textureLoader.load('./assets/path/GroundDirtWeedsPatchy004_AO_1K.jpg');
const pathGlossMap = textureLoader.load('./assets/path/GroundDirtWeedsPatchy004_GLOSS_1K.jpg');

pathColorMap.colorSpace = THREE.SRGBColorSpace;

[pathColorMap, pathNormalMap, pathAOMap, pathGlossMap].forEach(tex => {

  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;

  tex.repeat.set(8, 8);

});

const pathMaterial = new THREE.MeshStandardMaterial({

  map: pathColorMap,
  normalMap: pathNormalMap,
  aoMap: pathAOMap,
  roughness: 1.0
});

// ─── PRELOAD DOS MODELOS ─────────────────────────────────────────────────────

async function preloadChunkModels() {

  // Crie o objeto se ele não existir solto no topo do código
  if (typeof window.modelTemplates === 'undefined') window.modelTemplates = {};

  // Carrega o material e depois o objeto
  const mtlLoader = new MTLLoader();
  mtlLoader.setPath('./assets/45/'); // MUDE AQUI PARA A SUA PASTA

  mtlLoader.load('alvo1.mtl', (materials) => {
    materials.preload();

    const objLoader = new OBJLoader();
    objLoader.setMaterials(materials);
    objLoader.setPath('./assets/45/'); // MUDE AQUI TAMBÉM

    objLoader.load('alvo1obj.obj', (object) => {
      // Centraliza o modelo matematicamente para o Cannon.js entender
      const box = new THREE.Box3().setFromObject(object);
      const center = box.getCenter(new THREE.Vector3());
      object.position.sub(center);

      // Ajuste a escala se o modelo vier gigante ou minúsculo
      object.scale.set(0.1, 0.1, 0.1);

      // Salva na memória global para clonar depois
      modelTemplates.alvo = object;
    });
  });

  window.preloadAlvo = function () {
    return new Promise((resolve) => {
      if (typeof window.modelTemplates === 'undefined') window.modelTemplates = {};

      const mtlLoader = new MTLLoader();
      mtlLoader.setPath('./assets/45/');

      mtlLoader.load('alvo1.mtl', (materials) => {
        materials.preload();

        const objLoader = new OBJLoader();
        objLoader.setMaterials(materials);
        objLoader.setPath('./assets/45/');

        objLoader.load('alvo1obj.obj', (object) => {

          // 1. Calcula o centro enquanto o objeto ainda é gigante
          const box = new THREE.Box3().setFromObject(object);
          const center = box.getCenter(new THREE.Vector3());

          // 2. Move o objeto para ficar perfeitamente no eixo zero
          object.position.set(-center.x, -box.min.y, -center.z);

          // 3. Cria o "Pacote Invisível" e coloca o objeto dentro
          const pacote = new THREE.Group();
          pacote.add(object);

          // 4. Encolhe o PACOTE (isso preserva o centro matematicamente perfeito)
          pacote.scale.set(0.1, 0.1, 0.1);

          modelTemplates.alvo = pacote;
          resolve();
        });
      });
    });
  };

  const loader = new GLTFLoader();

  const models = [
    { key: "ground", path: "./assets/models/ground_grass.glb" },
    { key: "plant", path: "./assets/models/plant_flatShort.glb" },
    { key: "rock", path: "./assets/models/rock_largeB.glb" },
    { key: "tree", path: "./assets/models/tree_thin.glb" },
  ];

  const promises = models.map(({ key, path }) => {
    return new Promise((resolve) => {
      loader.load(
        path,
        (gltf) => {
          modelTemplates[key] = gltf.scene;
          resolve();
        },
        undefined,
        () => resolve(),
      );
    });
  });

  return Promise.all(promises);
}

// ─── DECORAÇÃO PROCEDURAL ────────────────────────────────────────────────────

function seedDecorations(chunkGroup) {
  const half = CHUNK_SIZE / 2 - 10;

  const decorDefs = [
    { key: "plant", count: 8, scaleRange: [5, 10] },
    { key: "rock", count: 3, scaleRange: [2.5, 5] },
    { key: "tree", count: 4, scaleRange: [15, 30] },
  ];

  for (const { key, count, scaleRange } of decorDefs) {
    if (!modelTemplates[key]) continue;

    for (let i = 0; i < count; i++) {
      const clone = modelTemplates[key].clone(true);

      let localX, localZ;

      let validPosition = false;

      let attempts = 0;
      const maxAttempts = 30;

      while (!validPosition && attempts < maxAttempts) {

        localX = (Math.random() * 2 - 1) * half;
        localZ = (Math.random() * 2 - 1) * half;

        const worldPosX = chunkGroup.position.x + localX;
        const worldPosZ = chunkGroup.position.z + localZ;

        const corridorWidth = 30;
        const corridorLength = 5000;
        const spawnLineX = -40;
        const insideCorridor =
          Math.abs(worldPosX - spawnLineX) < corridorWidth &&
          worldPosZ > -corridorLength &&
          worldPosZ < 100;

        if (!insideCorridor) {
          validPosition = true;
        }

        attempts++;
      }

      if (!validPosition) continue;

      clone.position.set(localX, 0, localZ);

      clone.rotation.y = Math.random() * Math.PI * 2;

      clone.scale.setScalar(
        scaleRange[0] + Math.random() * (scaleRange[1] - scaleRange[0]),
      );

      chunkGroup.add(clone);
    }
  }
}

// ─── BUILD DO CHUNK ──────────────────────────────────────────────────────────

function buildChunk(chunkX, chunkZ) {
  const group = new THREE.Group();

  const worldX = chunkX * CHUNK_SIZE;
  const worldZ = chunkZ * CHUNK_SIZE;

  group.position.set(worldX, 0, worldZ);

  // SOLO DO CHUNK

  if (modelTemplates.ground) {
    const groundClone = modelTemplates.ground.clone(true);

    const box = new THREE.Box3().setFromObject(groundClone);

    const size = new THREE.Vector3();
    box.getSize(size);

    const center = new THREE.Vector3();
    box.getCenter(center);

    groundClone.position.set(-center.x, -box.max.y, -center.z);

    const scaleContainer = new THREE.Group();
    scaleContainer.add(groundClone);

    const scaleX = size.x > 0.1 ? CHUNK_SIZE / size.x : 1;
    const scaleZ = size.z > 0.1 ? CHUNK_SIZE / size.z : 1;

    scaleContainer.scale.set(scaleX, 1, scaleZ);

    group.add(scaleContainer);
  }
  const pathWidth = 50;
  const spawnLineX = -40;

  const isPathChunk =
    Math.abs(worldX - spawnLineX) < pathWidth;

  if (isPathChunk) {

    const pathMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(pathWidth, CHUNK_SIZE),
      pathMaterial
    );

    pathMesh.rotation.x = -Math.PI / 2;

    pathMesh.position.set(
      spawnLineX - worldX,
      0.3,
      0
    );

    group.add(pathMesh);
  }


  seedDecorations(group);
  // ==========================================
  // GERADOR DE ALVOS (Adaptado para THREE.Group)
  // ==========================================
  // Inicia um array no userData para guardar a física e apagar depois
  group.userData.bodies = [];

  // Verifica se o chunk atual está na mesma linha (X) da arma do jogador.
  // Só gera o alvo se a distância lateral for menor que a metade do chunk.
  // ==========================================
  // GERADOR DE ALVOS (Dentro de buildChunk)
  // ==========================================
  group.userData.bodies = [];

  if (Math.abs(config.startX - worldX) < CHUNK_SIZE / 2) {

    const distanciasAlvos = [worldZ - 100, worldZ - 200];

    distanciasAlvos.forEach(z => {
      if (z > -80) return;

      // 1. VISUAL: Modelo em pé e com pivot centralizado
      let meshAlvo;

      if (modelTemplates.alvo) {
        meshAlvo = new THREE.Group();
        const modeloImportado = modelTemplates.alvo.clone(true);

        // Levanta o modelo
        modeloImportado.rotation.x = -Math.PI / 2;

        // Centraliza o pivot no meio do objeto
        const box = new THREE.Box3().setFromObject(modeloImportado);
        const center = new THREE.Vector3();
        box.getCenter(center);
        modeloImportado.position.sub(center);

        meshAlvo.add(modeloImportado);
      } else {
        const fallbackGeo = new THREE.BoxGeometry(4, 4, 0.5);
        const fallbackMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        meshAlvo = new THREE.Mesh(fallbackGeo, fallbackMat);
        meshAlvo.geometry.center();
      }

      // ==========================================
      // PAINEL COMPLETO DE CONTROLE (Tamanho, Posição e Angulação)
      // ==========================================
      const larguraHitbox = 7.0;       // X: Estica para os lados
      const alturaHitbox = 10.0;        // Y: Estica para cima/baixo
      const profundidadeHitbox = 0.19;  // Z: Espessura da placa

      const alturaBaseNoChao = 2.5;    // Altura onde a imagem do alvo fica no jogo

      const ajusteAlturaHitbox = 0;    // Sobe ou desce SÓ a física
      const ajusteProfundidade = 0.2;  // Empurra a física pra frente ou pra trás

      const grausInclinacao = -25;     // Inclinação do alvo (ex: -10 graus)
      // ==========================================

      // Coloca o visual no mapa
      meshAlvo.position.set(config.startX - worldX, alturaBaseNoChao, z - worldZ);
      group.add(meshAlvo);

      // 2. FÍSICA: Usando os controles manuais
      const halfExtents = new CANNON.Vec3(larguraHitbox / 2, alturaHitbox / 2, profundidadeHitbox / 2);
      const targetShape = new CANNON.Box(halfExtents);

      const targetBody = new CANNON.Body({
        mass: 0,
        shape: targetShape,
      });

      // Aplica os offsets de posição globalmente
      targetBody.position.set(config.startX, alturaBaseNoChao + ajusteAlturaHitbox, z + ajusteProfundidade);

      // Aplica a inclinação na física
      const inclinacaoRadianos = grausInclinacao * (Math.PI / 180);
      targetBody.quaternion.setFromEuler(inclinacaoRadianos, 0, 0);

      targetBody.isAlvo = true;
      targetBody.meshVisual = meshAlvo;

      world.addBody(targetBody);
      group.userData.bodies.push(targetBody);

      // 3. MODO RAIO-X: Acompanha 100% a física
      const helperGeo = new THREE.BoxGeometry(larguraHitbox, alturaHitbox, profundidadeHitbox);
      const helperMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true });
      const helperMesh = new THREE.Mesh(helperGeo, helperMat);

      // Aplica os mesmos offsets e rotação do Cannon para o Three.js
      helperMesh.position.set(config.startX - worldX, alturaBaseNoChao + ajusteAlturaHitbox, (z - worldZ) + ajusteProfundidade);
      helperMesh.rotation.x = inclinacaoRadianos;

      group.add(helperMesh);
    });
  }
  group.userData.x = chunkX;
  group.userData.z = chunkZ;

  return group;

  group.userData = {
    x: chunkX,
    z: chunkZ,
  };
}


// ─── SPAWN ───────────────────────────────────────────────────────────────────

function spawnChunk(chunkX, chunkZ) {
  const chunk = buildChunk(chunkX, chunkZ);

  scene.add(chunk);

  activeChunks.push(chunk);
}

// ─── UPDATE DOS CHUNKS ───────────────────────────────────────────────────────

function updateChunks() {
  const camX = Math.floor(camera.position.x / CHUNK_SIZE);
  const camZ = Math.floor(camera.position.z / CHUNK_SIZE);

  // REMOVE CHUNKS DISTANTES

  for (let i = activeChunks.length - 1; i >= 0; i--) {
    const chunk = activeChunks[i];

    const distX = Math.abs(chunk.userData.x - camX);
    const distZ = Math.abs(chunk.userData.z - camZ);

    if (distX > VIEW_RADIUS || distZ > VIEW_RADIUS) {
      scene.remove(chunk);
      if (chunk.userData.bodies) {
        chunk.userData.bodies.forEach(body => world.removeBody(body));
      }
      chunk.traverse((child) => {
        if (!child.isMesh) return;

        child.geometry?.dispose();

        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material?.dispose();
        }
      });

      activeChunks.splice(i, 1);
    }
  }

  // CRIA NOVOS CHUNKS

  for (let x = -VIEW_RADIUS; x <= VIEW_RADIUS; x++) {
    for (let z = -VIEW_RADIUS; z <= VIEW_RADIUS; z++) {
      const targetX = camX + x;
      const targetZ = camZ + z;

      const exists = activeChunks.some(
        (chunk) => chunk.userData.x === targetX && chunk.userData.z === targetZ,
      );

      if (!exists) {
        spawnChunk(targetX, targetZ);
      }
    }
  }
}
// ─── INIT ─────────────────────────────────────────────────────────────────────

async function init() {
  scene = new THREE.Scene();

  // SKY DO PRIMEIRO CÓDIGO

  const sky = new Sky();
  sky.scale.setScalar(450000);
  scene.add(sky);

  const sunVector = new THREE.Vector3();

  const skyUniforms = sky.material.uniforms;

  skyUniforms["turbidity"].value = 10;
  skyUniforms["rayleigh"].value = 2;
  skyUniforms["mieCoefficient"].value = 0.005;
  skyUniforms["mieDirectionalG"].value = 0.8;

  const elevation = 35;
  const azimuth = -45;

  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);

  sunVector.setFromSphericalCoords(1, phi, theta);

  sky.material.uniforms["sunPosition"].value.copy(sunVector);

  const sunLight = new THREE.DirectionalLight(0xffffff, 2);

  sunLight.position.copy(sunVector).multiplyScalar(100);

  scene.add(sunLight);

  scene.add(new THREE.AmbientLight(0xffffff, 1.5));

  scene.fog = new THREE.FogExp2(0x87ceeb, 0.0015);

  // CAMERA

  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    2000,
  );

  camera.rotation.order = "YXZ";

  camera.position.set(config.startX, config.startY, 10);

  // AUDIO

  const listener = new THREE.AudioListener();
  camera.add(listener);

  fireSound = new THREE.Audio(listener);

  const audioLoader = new THREE.AudioLoader();

  audioLoader.load("./assets/tiro.mp3", (buffer) => {
    fireSound.setBuffer(buffer);
    fireSound.setVolume(0.5);
  });

  // RENDERER

  renderer = new THREE.WebGLRenderer({
    antialias: true,
  });

  renderer.setSize(window.innerWidth, window.innerHeight);

  renderer.shadowMap.enabled = true;

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.5;

  document.body.appendChild(renderer.domElement);

  // CONTROLES

  const controls = new OrbitControls(camera, renderer.domElement);

  controls.target.set(config.startX, config.startY, 5);

  controls.update();

  // ─── FÍSICA (MANTIDA DO SEGUNDO CÓDIGO) ────────────────────────────────

  world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -config.gravity, 0),
  });

  world.allowSleep = true;

  physicsMaterial = new CANNON.Material("standard");

  world.addContactMaterial(
    new CANNON.ContactMaterial(physicsMaterial, physicsMaterial, {
      friction: 0.05,
      restitution: 0.6,
    }),
  );

  // CHÃO FÍSICO INFINITO

  groundBody = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Plane(),
    material: physicsMaterial,
  });

  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);

  world.addBody(groundBody);

  // ─── SISTEMA PROCEDURAL ────────────────────────────────────────────────

  // ─── SISTEMA PROCEDURAL ────────────────────────────────────────────────

  await preloadChunkModels(); // Carrega o chão e árvores (sua função original)
  await preloadAlvo();        // Carrega o alvo (a função nova)

  updateChunks();             // Só gera o mapa depois que TUDO estiver carregado

  // ─── LOADERS ───────────────────────────────────────────────────────────

  loadModel();
  loadPistol();

  animate();
}

// ─── PISTOLA ─────────────────────────────────────────────────────────────────

function loadPistol() {
  const gltfLoader = new GLTFLoader();

  const textureLoader = new THREE.TextureLoader();

  const texPath = "./assets/source/";

  const colorMap = textureLoader.load(texPath + "berettaColor.png");

  colorMap.colorSpace = THREE.SRGBColorSpace;

  const normalMap = textureLoader.load(texPath + "berettaNormal.png");

  const roughnessMap = textureLoader.load(texPath + "berettaRoughness.png");

  const metallicMap = textureLoader.load(texPath + "berettaMetallic.png");

  const aoMap = textureLoader.load(texPath + "berettaAO.png");

  const armsColorMap = textureLoader.load(texPath + "armsColor.png");

  armsColorMap.colorSpace = THREE.SRGBColorSpace;

  const armsNormalMap = textureLoader.load(texPath + "armsNormal.png");

  const armsRoughnessMap = textureLoader.load(texPath + "armsRoughness.png");

  const armsAOMap = textureLoader.load(texPath + "armsAO.png");

  gltfLoader.load(texPath + "pistola.glb", (gltf) => {
    const object = gltf.scene;

    const box = new THREE.Box3().setFromObject(object);

    const center = box.getCenter(new THREE.Vector3());

    object.position.sub(center);

    object.traverse((child) => {
      if (!child.isMesh) return;

      if (child.geometry.attributes.uv) {
        child.geometry.setAttribute(
          "uv2",
          new THREE.BufferAttribute(child.geometry.attributes.uv.array, 2),
        );
      }

      const meshName = child.name.toLowerCase();

      if (meshName.includes("arms") || meshName.includes("braço")) {
        child.material = new THREE.MeshStandardMaterial({
          map: armsColorMap,
          normalMap: armsNormalMap,
          roughnessMap: armsRoughnessMap,
          aoMap: armsAOMap,
          aoMapIntensity: 1,
          metalness: 0,
          side: THREE.DoubleSide,
        });
      } else {
        child.material = new THREE.MeshStandardMaterial({
          map: colorMap,
          normalMap,
          roughnessMap,
          metalnessMap: metallicMap,
          aoMap,
          aoMapIntensity: 1,
          side: THREE.DoubleSide,
        });
      }

      child.raycast = () => { };
    });

    object.rotation.y = Math.PI;

    // ANIMAÇÃO

    if (gltf.animations?.length > 0) {
      mixer = new THREE.AnimationMixer(object);

      const shootClip = THREE.AnimationUtils.subclip(
        gltf.animations[0],
        "Atirar",
        0,
        13,
        30,
      );

      shootAction = mixer.clipAction(shootClip);

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

// ─── PROJÉTIL + FÍSICA ORIGINAL ──────────────────────────────────────────────

function loadModel() {
  const textureLoader = new THREE.TextureLoader();

  textureLoader.load("./assets/45/tex_2/dirt_texture.jpg", (colorTexture) => {
    colorTexture.colorSpace = THREE.SRGBColorSpace;

    const scratchTexture = textureLoader.load(
      "./assets/45/tex_2/metal_scratches.jpg",
    );

    const objLoader = new OBJLoader();

    objLoader.setPath("./assets/45/");

    objLoader.load("45.obj", (object) => {
      const box = new THREE.Box3().setFromObject(object);

      const center = box.getCenter(new THREE.Vector3());

      object.position.sub(center);

      object.traverse((child) => {
        if (!child.isMesh) return;

        child.material = new THREE.MeshStandardMaterial({
          map: colorTexture,
          color: 0xffffff,
          metalness: 0.3,
          roughness: 0.4,
          roughnessMap: scratchTexture,
        });
      });

      object.rotation.z = -Math.PI / 2;

      projectile = new THREE.Group();

      projectile.add(object);

      projectile.visible = false;

      scene.add(projectile);

      // CORPO FÍSICO ORIGINAL

      projectileBody = new CANNON.Body({
        mass: 1,

        shape: new CANNON.Box(new CANNON.Vec3(1.25, 0.4, 0.4)),

        material: physicsMaterial,

        linearDamping: 0.1,
        angularDamping: 0.5,

        fixedRotation: true,

        collisionFilterGroup: 1,
        collisionFilterMask: -1,
      });

      // Sensor de Colisão Único
      projectileBody.addEventListener("collide", (e) => {

        // 1. Checa se bateu no chão
        if (e.body === groundBody && !hasBounced) {
          hasBounced = true;
          projectileBody.fixedRotation = false;
          projectileBody.updateMassProperties();
        }

        // 2. Checa se bateu no alvo
        if (e.body.isAlvo && !e.body.jaFoiAcertado) {
          e.body.jaFoiAcertado = true;
          hitAlvo = true;
          // Percorre todas as partes do modelo 3D
          e.body.meshVisual.traverse((child) => {
            if (child.isMesh) {
              // Clona o material apenas deste alvo específico para não afetar os outros
              child.material = child.material.clone();

              // Pinta de verde (você pode usar emissive se a textura for muito escura)
              child.material.color.setHex(0x00ff00);

              // Se quiser que ele brilhe no escuro quando acertar, descomente abaixo:
              // child.material.emissive.setHex(0x00ff00);
            }
          });
          console.log("🎯 ALVO ABATIDO! Distância: " + Math.abs(e.body.position.z).toFixed(0) + " metros!");
        }

      });

      world.addBody(projectileBody);

      isLoaded = true;
    });
  });
}
// ─── ANIMATE ─────────────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  
  // ─────────────────────────────────────────────
  // STEP FÍSICO
  // ─────────────────────────────────────────────

  world.step(1 / 60, delta, 10);

  // ─────────────────────────────────────────────
  // UPDATE DOS CHUNKS
  // ─────────────────────────────────────────────

  updateChunks();

  // ─────────────────────────────────────────────
  // PROJÉTIL
  // ─────────────────────────────────────────────

  if (projectile && projectileBody) {
    // posição física normal
    // SEM smoothing na bala

    projectile.position.copy(projectileBody.position);

    // ─────────────────────────────────────────
    // ROTAÇÃO EM VOO
    // ─────────────────────────────────────────

    if (!hasBounced) {
      const velocityVector = new THREE.Vector3(
        projectileBody.velocity.x,
        projectileBody.velocity.y,
        projectileBody.velocity.z,
      );

      if (velocityVector.lengthSq() > 0.0001) {
        const tempLooker = new THREE.Object3D();

        tempLooker.position.copy(projectile.position);

        tempLooker.lookAt(projectile.position.clone().add(velocityVector));

        tempLooker.rotateY(-Math.PI / 2);

        // VISUAL acompanha física

        projectile.quaternion.copy(tempLooker.quaternion);

        // mantém física original

        projectileBody.quaternion.copy(tempLooker.quaternion);
      }
    } else {
      // após ricochete

      projectile.quaternion.copy(projectileBody.quaternion);
    }
  }

  // ─────────────────────────────────────────────
  // ANIMAÇÃO DA ARMA
  // ─────────────────────────────────────────────

  if (mixer) mixer.update(delta);

  const crosshair = document.getElementById("crosshair");

  // ─────────────────────────────────────────────
  // CAMERA FPS
  // ─────────────────────────────────────────────

  if (cameraTarget === "pistol") {
    if (pistol) pistol.visible = true;

    if (crosshair) crosshair.style.visibility = "visible";

    camera.position.set(config.startX, config.startY, 10);

    camera.rotation.set(pitch, yaw, 0, "YXZ");
  }

  // ─────────────────────────────────────────────
  // BULLETCAM ESTABILIZADA
  // ─────────────────────────────────────────────
  else if (cameraTarget === "bullet" && projectile && projectileBody) {
    if (pistol) pistol.visible = true;

    if (crosshair) crosshair.style.visibility = "hidden";

    // ─────────────────────────────────────────
    // DIREÇÃO DA BALA
    // ─────────────────────────────────────────

    const velocityDir = new THREE.Vector3(
      projectileBody.velocity.x,
      projectileBody.velocity.y,
      projectileBody.velocity.z,
    );

    const speed = velocityDir.length();

    if (speed > 0.0001) {
      velocityDir.normalize();
    }

    // ─────────────────────────────────────────
    // OFFSET DINÂMICO
    // estável após ricochete
    // ─────────────────────────────────────────

    const offsetX = bulletRadius * Math.sin(bulletYaw) * Math.cos(bulletPitch);
    const offsetY = bulletRadius * Math.sin(bulletPitch);
    const offsetZ = bulletRadius * Math.cos(bulletYaw) * Math.cos(bulletPitch);
    
    const bulletOffset = new THREE.Vector3(offsetX, offsetY, offsetZ);

    // ─────────────────────────────────────────
    // POSIÇÃO ALVO
    // ─────────────────────────────────────────

    const desiredCameraPosition = projectile.position.clone().add(bulletOffset);

    // Impede a câmera de passar do chão (o void). 
    if (desiredCameraPosition.y < 0.5) {
      desiredCameraPosition.y = 0.5;
    }

    // ─────────────────────────────────────────
    // SMOOTH POSITION
    // ─────────────────────────────────────────

    if (!camera.userData.smoothPosition) {
      camera.userData.smoothPosition = desiredCameraPosition.clone();
    }

    camera.userData.smoothPosition.lerp(desiredCameraPosition, 0.2); 
    camera.position.copy(camera.userData.smoothPosition);

    camera.lookAt(projectile.position);

    // ─────────────────────────────────────────
    // LOOK TARGET SUAVIZADO
    // ─────────────────────────────────────────

    if (!camera.userData.lookTarget) {
      camera.userData.lookTarget = projectile.position.clone();
    }

    camera.userData.lookTarget.lerp(projectile.position, 0.12);

    camera.lookAt(camera.userData.lookTarget);

    // ─────────────────────────────────────────
    // FINALIZA BULLETCAM
    // ─────────────────────────────────────────

    if ((speed < 0.2 && hasBounced) || projectileBody.position.y < -10) {
      if (!window.returnTimer) {
        window.returnTimer = setTimeout(() => {
          // Adiciona última amostra de impacto
          const finalSpd = new THREE.Vector3(
            projectileBody.velocity.x,
            projectileBody.velocity.y,
            projectileBody.velocity.z
          ).length();
          trajectorySamples.push({
            t: clock.elapsedTime,
            z: projectileBody.position.z,
            y: Math.max(0, projectileBody.position.y),
            spd: finalSpd
          });

          // Normaliza os tempos para começar do zero
          if (trajectorySamples.length > 0) {
            const t0 = trajectorySamples[0].t;
            trajectorySamples.forEach(s => s.t -= t0);
          }

          // Mostra o relatório
          if (window.mostrarRelatorio) {
            window.mostrarRelatorio(trajectorySamples, hitAlvo);
          }

          isFiring = false;
          cameraTarget = "pistol";
          // ... resto do reset original
        }, 1000);
      }
    }
  }

  if (projectile.visible && !hasBounced) {
    trajectoryTimer += delta;
    if (trajectoryTimer >= 0.25) { // coleta a cada 0.25s
      trajectoryTimer = 0;
      const spd = new THREE.Vector3(
        projectileBody.velocity.x,
        projectileBody.velocity.y,
        projectileBody.velocity.z
      ).length();
      trajectorySamples.push({
        t: clock.elapsedTime,
        z: projectileBody.position.z,
        y: projectileBody.position.y,
        spd: spd
      });
    }
  }

  renderer.render(scene, camera);
}
// ─── EVENTOS ────────────────────────────────────────────────────────────────

document.addEventListener("click", (e) => {
  if (e.target.closest(".lil-gui")) return;
  if (document.getElementById('ballistics-overlay').classList.contains('visible')) return; // ADICIONE

  if (cameraTarget === "pistol") {
    renderer.domElement.requestPointerLock();
  }
});

// ─── MOUSE LOOK ─────────────────────────────────────────────────────────────

document.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement === renderer.domElement && !isFiring && cameraTarget === "pistol") {
    
    pitch -= e.movementY * sensitivity;

    //ângulo -20 a 60
    pitch = Math.max(
      -20 * (Math.PI / 180),
      Math.min(60 * (Math.PI / 180), pitch),
    );

    config.angle = parseFloat((pitch * (180 / Math.PI)).toFixed(1));
    
  } else if (document.pointerLockElement === renderer.domElement && cameraTarget === "bullet") {
    // Gira a câmera em volta da bala
    bulletYaw -= e.movementX * sensitivity;
    bulletPitch += e.movementY * sensitivity;

    // Limita o pitch para a câmera não virar de cabeça para baixo
    bulletPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, bulletPitch));
  }
});

// ─── DISPARO ────────────────────────────────────────────────────────────────

window.addEventListener("mousedown", (e) => {
  if (e.target.closest(".lil-gui")) return;
  if (document.getElementById('ballistics-overlay').classList.contains('visible')) return; // ADICIONE

  if (document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
    return;
  }

  if (e.button === 0 && isLoaded && !isFiring && pistol && projectileBody) {
    if (window.returnTimer) {
      clearTimeout(window.returnTimer);

      window.returnTimer = null;
    }

    trajectorySamples = [];
    trajectoryTimer = 0;
    hitAlvo = false;

    isFiring = true;

    hasBounced = false;

    projectile.visible = true;

    projectileBody.wakeUp();

    projectileBody.fixedRotation = true;

    // ─── SPAWN POSITION ───────────────────────────────────────────────

    const barrelTipOffset = new THREE.Vector3(-2, 13.3, -30);

    const spawnPosition = barrelTipOffset.clone();

    pistol.localToWorld(spawnPosition);

    projectileBody.position.copy(spawnPosition);

    projectileBody.velocity.set(0, 0, 0);

    // ─── GIRO ALEATÓRIO ───────────────────────────────────────────────

    projectileBody.angularVelocity.set(
      (Math.random() - 0.5) * 5,
      (Math.random() - 0.5) * 5,
      (Math.random() - 0.5) * 5,
    );

    // ─── MIRA REAL ───────────────────────────────────────────────────

    const raycaster = new THREE.Raycaster();

    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

    const targetPoint = new THREE.Vector3();

    raycaster.ray.at(1000, targetPoint);

    const direction = new THREE.Vector3()
      .subVectors(targetPoint, spawnPosition)
      .normalize();

    console.log(direction);

    // A câmera é posicionada nas costas da bala
    bulletYaw = Math.atan2(-direction.x, -direction.z); 
    bulletPitch = 0.2; // Leve inclinada pra cima

    projectileBody.velocity.set(
      direction.x * config.v0,
      direction.y * config.v0,
      direction.z * config.v0,
    );

    // ─── ROTAÇÃO DA BALA ─────────────────────────────────────────────

    const tempLooker = new THREE.Object3D();

    tempLooker.lookAt(direction);

    tempLooker.rotateY(-Math.PI / 2);

    flightQuaternion.copy(tempLooker.quaternion);

    projectileBody.quaternion.copy(flightQuaternion);

    projectile.quaternion.copy(flightQuaternion);

    // ─── FX ──────────────────────────────────────────────────────────

    if (shootAction) {
      shootAction.stop().play();
    }

    if (fireSound?.buffer) {
      if (fireSound.isPlaying) {
        fireSound.stop();
      }

      fireSound.play();
    }

    // ─── CAMERA BALA ────────────────────────────────────────────────

    setTimeout(() => {
      cameraTarget = "bullet";

      scene.attach(pistol);
    }, 100);
  }
});

// ─── RESIZE ─────────────────────────────────────────────────────────────────

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;

  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener("contextmenu", (e) => e.preventDefault());

// ─── INIT ───────────────────────────────────────────────────────────────────

init();

// ─── GUI ────────────────────────────────────────────────────────────────────

iniciarInterface(config, world, (modo) => {
  modoVisaoPainel = modo; 

  if (modo === "LIVRE") {
    cameraTarget = "none";
    document.exitPointerLock();
  } else {
    cameraTarget = "pistol";
  }
});

// ─── RESET ──────────────────────────────────────────────────────────────────

window.forcarResetDaCena = function () {
  document.exitPointerLock();
  if (window.returnTimer) {
    clearTimeout(window.returnTimer);

    window.returnTimer = null;
  }

  isFiring = false;

  hasBounced = false;

  cameraTarget = "pistol";

  // RESGATA A ARMA

  if (typeof pistol !== "undefined" && pistol && camera) {
    camera.attach(pistol);

    pistol.position.set(2, -4, -2);

    pistol.rotation.set(0, 0, 0);
  }

  // RESET DA BALA

  if (typeof projectileBody !== "undefined" && projectileBody && projectile) {
    projectileBody.sleep();

    projectileBody.position.set(0, -100, 0);

    projectileBody.velocity.set(0, 0, 0);

    projectileBody.angularVelocity.set(0, 0, 0);

    projectile.visible = false;
  }

  // CAMERA

  if (camera) {
    camera.position.set(config.startX, config.startY, 10);

    pitch = 0;
  }
};

// ─── CONTROLE DE PITCH VIA GUI ──────────────────────────────────────────────

window.atualizarPitchPelaInterface = function (anguloEmGraus) {
  if (!isFiring) {
    const clampado = Math.max(-20, Math.min(60, anguloEmGraus));
    pitch = clampado * (Math.PI / 180);
  }
};