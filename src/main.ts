import { BrowserQRCodeReader } from "@zxing/browser";
import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";

const video = document.getElementById("camera") as HTMLVideoElement;
const qrReader = new BrowserQRCodeReader();
let scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer, model: THREE.Object3D | null = null;
let lastQRLocation: { x: number, y: number, width: number, height: number } | null = null;
let lastQRTimestamp = 0; // Timestamp de la última vez que se detectó un QR
const QR_TIMEOUT = 1000; // Tiempo en ms después del cual se considera que el QR ya no está visible

async function startQRScanner() {
  try {
    const devices = await BrowserQRCodeReader.listVideoInputDevices();

    const preferredDevice = devices.find((device: MediaDeviceInfo) =>
      device.label.toLowerCase().includes("back")
    ) || devices[0];

    if (!preferredDevice) {
      throw new Error("No se encontró ninguna cámara");
    }

    // Escaneo continuo desde el dispositivo seleccionado
    await qrReader.decodeFromVideoDevice(preferredDevice.deviceId, video, (result, error, controls) => {
      if (result) {
        const qrData = result.getText();
        console.log("QR detectado:", qrData);
        showResult(qrData);
        
        // Actualizar el timestamp cada vez que se detecta un QR
        lastQRTimestamp = Date.now();
        
        // Obtener los puntos del QR
        const resultPoints = result.getResultPoints();
        if (resultPoints && resultPoints.length >= 3) {
          // Calcular el centro y el tamaño aproximado del QR
          const minX = Math.min(...resultPoints.map(p => p.getX()));
          const maxX = Math.max(...resultPoints.map(p => p.getX()));
          const minY = Math.min(...resultPoints.map(p => p.getY()));
          const maxY = Math.max(...resultPoints.map(p => p.getY()));
          
          const qrWidth = maxX - minX;
          const qrHeight = maxY - minY;
          const qrCenterX = (minX + maxX) / 2;
          const qrCenterY = (minY + maxY) / 2;
          
          // Guardar la ubicación del QR
          lastQRLocation = {
            x: qrCenterX,
            y: qrCenterY,
            width: qrWidth,
            height: qrHeight
          };
          
          // Cargar el modelo si es la primera vez que se detecta este QR
          if (!model) {
            loadModelFromURL(qrData);
          }
        }
      }
    });

  } catch (err) {
    console.error("Error al iniciar el escáner:", err);
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

function init3DScene() {
  // Crear la escena de Three.js
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  renderer = new THREE.WebGLRenderer({ alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  // Ajustar el estilo del canvas para asegurarse de que esté visible
  renderer.domElement.style.position = "absolute";
  renderer.domElement.style.top = "0";
  renderer.domElement.style.left = "0";
  renderer.domElement.style.zIndex = "2"; // Asegúrate de que el canvas esté por encima del video

  // Agregar luz
  const ambientLight = new THREE.AmbientLight(0xffffff, 1);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.position.set(0, 10, 10);
  scene.add(directionalLight);

  camera.position.z = 5;
  animate();
}

function loadModelFromURL(url: string) {
  // Verificar si ya hay un modelo cargado y eliminarlo
  if (model) {
    scene.remove(model);
    model = null;
  }

  console.log("Intentando cargar modelo desde:", url);

  // Verifica si la URL es válida
  try {
    new URL(url);
  } catch (e) {
    console.error("URL inválida:", url);
    return;
  }

  const loader = new GLTFLoader();
  
  // Agrega una función de progreso para verificar el estado de la carga
  loader.load(
    url,
    (gltf) => {
      console.log("Modelo cargado correctamente:", gltf);
      model = gltf.scene;

      // Centrar el modelo en su bounding box
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center); // Centra el modelo

      // Escala el modelo para asegurarte de que sea visible
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0) {
        const scale = 4.0 / maxDim; // Aumentado de 2.0 a 4.0 para duplicar el tamaño inicial
        model.scale.multiplyScalar(scale);
      }

      // No posicionamos el modelo aquí, se posicionará en función del QR en animate()

      // Mantener los materiales originales del modelo
      model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (!child.material) {
            // Solo asignar material si no tiene uno
            child.material = new THREE.MeshStandardMaterial({ 
              color: 0x888888,
              roughness: 0.5,
              metalness: 0.5
            });
          }
        }
      });

      scene.add(model);
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
    // Necesitamos ajustar cómo mapeamos las coordenadas del video a la escena 3D
    
    // Primero asegurarnos de que tenemos las dimensiones correctas del video
    const videoWidth = video.videoWidth || video.clientWidth;
    const videoHeight = video.videoHeight || video.clientHeight;
    
    // Calcular las coordenadas normalizadas del centro del QR
    // Transformamos de coordenadas de píxeles [0,width/height] a coordenadas normalizadas [-1,1]
    // También invertimos el eje Y porque en el video el origen está arriba pero en Three.js está abajo
    const normalizedX = (lastQRLocation.x / videoWidth) * 2 - 1;
    const normalizedY = -((lastQRLocation.y / videoHeight) * 2 - 1);
    
    // Ajustar la posición del modelo
    // Reducimos los multiplicadores para un posicionamiento más preciso
    const aspectRatio = window.innerWidth / window.innerHeight;
    model.position.x = normalizedX * 3 * aspectRatio;
    model.position.y = normalizedY * 3;
    model.position.z = -3; // Mantén el modelo delante de la cámara
    
    // Ajustar la escala basada en el tamaño del QR
    // Esto hace que el modelo sea proporcional al tamaño del QR en la pantalla
    const qrSizeInViewport = Math.min(lastQRLocation.width, lastQRLocation.height) / videoWidth;
    const scaleFactor = qrSizeInViewport * 10; // Aumentado de 5 a 10 para duplicar el tamaño dinámico
    
    // Aplicamos la escala, manteniendo las proporciones originales del modelo
    model.scale.set(scaleFactor, scaleFactor, scaleFactor);
    
    // Opcional: agregar un marcador visual donde se detectó el QR (para depuración)
    console.log(`QR detectado en: (${normalizedX.toFixed(2)}, ${normalizedY.toFixed(2)})`);
  }
}
function animate() {
  requestAnimationFrame(animate);
  
  // Comprobar si el QR sigue siendo visible
  const qrIsVisible = Date.now() - lastQRTimestamp < QR_TIMEOUT;
  
  // Si el QR ya no es visible y tenemos un modelo, eliminarlo
  if (!qrIsVisible && model) {
    console.log("QR ya no es visible, eliminando modelo");
    scene.remove(model);
    model = null;
  }
  
  // Actualizar la posición del modelo solo si existe y el QR es visible
  if (model && qrIsVisible) {
    updateModelPosition();
  }
  
  // Rotar el modelo si existe
  if (model) {
    model.rotation.y += 0.01;
  }
  
  renderer.render(scene, camera);
}

// Inicializar la escena y el escáner QR
init3DScene();
startQRScanner();