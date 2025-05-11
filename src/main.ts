import { BrowserQRCodeReader } from "@zxing/browser";
import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";

const QR_TIMEOUT = 1000;
const ROTATION_SPEED = 0.01;
const ROTATION_DAMPING = 0.1;

const video = document.getElementById("camera") as HTMLVideoElement;
const qrReader = new BrowserQRCodeReader();

let scene: THREE.Scene;
let camera: THREE.Camera; 
let renderer: THREE.WebGLRenderer;
let model: THREE.Object3D | null = null;

let lastQRLocation: { x: number, y: number, width: number, height: number } | null = null;
let lastQRTimestamp = 0; 

let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };
let targetRotation = { x: 0, y: 0 };
let currentRotation = { x: 0, y: 0 };

function initApplication() {
  init3DScene();
  startQRScanner();
}

function init3DScene() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  renderer = new THREE.WebGLRenderer({ alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  renderer.domElement.style.position = "absolute";
  renderer.domElement.style.top = "0";
  renderer.domElement.style.left = "0";
  renderer.domElement.style.zIndex = "2";

  const ambientLight = new THREE.AmbientLight(0xffffff, 1);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.position.set(0, 10, 10);
  scene.add(directionalLight);

  camera.position.z = 5;
  
  setupMouseControls();
  
  animate();
}

function setupMouseControls() {
  renderer.domElement.addEventListener('mousedown', onMouseDown, false);
  renderer.domElement.addEventListener('touchstart', onTouchStart, false);
  window.addEventListener('mousemove', onMouseMove, false);
  window.addEventListener('touchmove', onTouchMove, false);
  window.addEventListener('mouseup', onMouseUp, false);
  window.addEventListener('touchend', onMouseUp, false);
  window.addEventListener('mouseleave', onMouseUp, false);
}

function onMouseDown(event: MouseEvent) {
  if (model && Date.now() - lastQRTimestamp < QR_TIMEOUT) {
    isDragging = true;
    previousMousePosition = {
      x: event.clientX,
      y: event.clientY
    };
    event.preventDefault();
  }
}

function onTouchStart(event: TouchEvent) {
  if (model && Date.now() - lastQRTimestamp < QR_TIMEOUT) {
    isDragging = true;
    previousMousePosition = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY
    };
    event.preventDefault();
  }
}

function onMouseMove(event: MouseEvent) {
  if (isDragging && model) {
    const deltaMove = {
      x: event.clientX - previousMousePosition.x,
      y: event.clientY - previousMousePosition.y
    };

    targetRotation.y += deltaMove.x * ROTATION_SPEED;
    targetRotation.x += deltaMove.y * ROTATION_SPEED;

    previousMousePosition = {
      x: event.clientX,
      y: event.clientY
    };
    
    event.preventDefault();
  }
}

function onTouchMove(event: TouchEvent) {
  if (isDragging && model) {
    const deltaMove = {
      x: event.touches[0].clientX - previousMousePosition.x,
      y: event.touches[0].clientY - previousMousePosition.y
    };

    targetRotation.y += deltaMove.x * ROTATION_SPEED;
    targetRotation.x += deltaMove.y * ROTATION_SPEED;

    previousMousePosition = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY
    };
    
    event.preventDefault();
  }
}

function onMouseUp() {
  isDragging = false;
}

async function startQRScanner() {
  try {
    const devices = await BrowserQRCodeReader.listVideoInputDevices();

    const preferredDevice = devices.find((device: MediaDeviceInfo) =>
      device.label.toLowerCase().includes("back")
    ) || devices[0];

    if (!preferredDevice) {
      throw new Error("No se encontró ninguna cámara");
    }

    await qrReader.decodeFromVideoDevice(preferredDevice.deviceId, video, (result, _error, _controls) => {
      if (result) {
        const qrData = result.getText();
        console.log("QR detectado:", qrData);
        showResult(qrData);
        
        lastQRTimestamp = Date.now();
        
        processQRPoints(result.getResultPoints());
        
        if (!model) {
          loadModel(qrData);
        }
      }
    });

  } catch (err) {
    console.error("Error al iniciar el escáner:", err);
  }
}

function processQRPoints(resultPoints: any[] | null) {
  if (resultPoints && resultPoints.length >= 3) {
    const minX = Math.min(...resultPoints.map(p => p.getX()));
    const maxX = Math.max(...resultPoints.map(p => p.getX()));
    const minY = Math.min(...resultPoints.map(p => p.getY()));
    const maxY = Math.max(...resultPoints.map(p => p.getY()));
    
    const qrWidth = maxX - minX;
    const qrHeight = maxY - minY;
    const qrCenterX = (minX + maxX) / 2;
    const qrCenterY = (minY + maxY) / 2;
    
    lastQRLocation = {
      x: qrCenterX,
      y: qrCenterY,
      width: qrWidth,
      height: qrHeight
    };
  }
}

function showResult(data: string) {
  const existing = document.getElementById("qr-result");
  if (existing) {
    existing.textContent = `QR: ${data}`;
  } else {
    const div = document.createElement("div");
    div.id = "qr-result";
    div.textContent = `QR: ${data}`;
    div.style.position = "absolute";
    div.style.top = "10px";
    div.style.left = "10px";
    div.style.color = "white";
    div.style.background = "rgba(0,0,0,0.5)";
    div.style.padding = "10px";
    div.style.zIndex = "999";
    document.body.appendChild(div);
  }
}

function loadModel(url: string) {
  if (model) {
    scene.remove(model);
    model = null;
  }

  console.log("Intentando cargar modelo desde:", url);

  try {
    new URL(url);
  } catch (e) {
    console.error("URL inválida:", url);
    return;
  }

  const loader = new GLTFLoader();
  
  loader.load(
    url,
    (gltf) => {
      console.log("Modelo cargado correctamente:", gltf);
      model = gltf.scene;

      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);

      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0) {
        const scale = 4.0 / maxDim;
        model.scale.multiplyScalar(scale);
      }

      model.traverse((child) => {
        if (child instanceof THREE.Mesh && !child.material) {
          child.material = new THREE.MeshStandardMaterial({ 
            color: 0x888888, roughness: 0.5, metalness: 0.5
          });
        }
      });
    },
    (progress) => {
      console.log(`Progreso de carga: ${(progress.loaded / progress.total * 100).toFixed(2)}%`);
    },
    (error) => {
      console.error("Error al cargar el modelo desde la URL:", error);
    }
  );
}

function updateModelPosition() {
  if (model && lastQRLocation) {
    const videoWidth = video.videoWidth || video.clientWidth;
    const videoHeight = video.videoHeight || video.clientHeight;
    
    const normalizedX = (lastQRLocation.x / videoWidth) * 2 - 1;
    const normalizedY = -((lastQRLocation.y / videoHeight) * 2 - 1);
    
    const aspectRatio = window.innerWidth / window.innerHeight;
    model.position.x = normalizedX * 3 * aspectRatio;
    model.position.y = normalizedY * 3;
    model.position.z = -3;
    
    const qrSizeInViewport = Math.min(lastQRLocation.width, lastQRLocation.height) / videoWidth;
    const scaleFactor = qrSizeInViewport * 10;
    
    model.scale.set(scaleFactor, scaleFactor, scaleFactor);
    
    if (!model.parent) {
      scene.add(model);
      console.log("Modelo añadido a la escena y posicionado correctamente");
    }
    
    console.log(`QR detectado en: (${normalizedX.toFixed(2)}, ${normalizedY.toFixed(2)})`);
  }
}

function animate() {
  requestAnimationFrame(animate);
  
  const qrIsVisible = Date.now() - lastQRTimestamp < QR_TIMEOUT;

  if (!qrIsVisible && model) {
    console.log("QR ya no es visible, eliminando modelo");
    scene.remove(model);
    model = null;
  }
  
  if (model && qrIsVisible) {
    updateModelPosition();
    
    currentRotation.x += (targetRotation.x - currentRotation.x) * ROTATION_DAMPING;
    currentRotation.y += (targetRotation.y - currentRotation.y) * ROTATION_DAMPING;
    
    model.rotation.x = currentRotation.x;
    model.rotation.y = currentRotation.y;
  }
  
  renderer.render(scene, camera);
}

initApplication();