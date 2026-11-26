/* ============================================================
   SISTEMA DE ANIMAÇÕES 3D DE STATUS DE PEDIDOS — THREE.JS
   ------------------------------------------------------------
   Componente reutilizável e independente (uma cena, câmera e
   renderer por instância). Controlado pelo status REAL do
   backend; nunca altera o pedido no front-end.

   Uso:
     import { PedidoAnimacao } from "./animacao-pedido.js";
     import { normalizarStatus } from "./passe-booyah.js";

     const animacao = new PedidoAnimacao();
     const resposta = await consultarStatus(pedido);
     animacao.iniciar(container, normalizarStatus(resposta));
     ...
     animacao.atualizarStatus(normalizarStatus(novaResposta));
     ...
     animacao.destruir();

   Estados visuais (canônicos):
     "pending"   -> pendente
     "delivered" -> entregue
     "cancelled" -> cancelado

   A adaptação do status real da Tokito para esses estados fica em
   ./passe-booyah.js (normalizarStatus).
   ============================================================ */

import * as THREE from "three";

// Texto de interface associado a cada estado (renderizado fora do canvas).
export const STATUS_INFO = {
  pending: {
    title: "PEDIDO PENDENTE",
    description: "Estamos aguardando a confirmação da entrega do seu passe.",
  },
  delivered: {
    title: "PASSE ENTREGUE!",
    description: "Seu Passe Booyah foi enviado com sucesso.",
  },
  cancelled: {
    title: "PEDIDO CANCELADO",
    description: "Este pedido foi cancelado.",
  },
};

const COLOR = {
  gold: 0xffc400,
  goldSoft: 0xffda35,
  purple: 0x8b35f5,
  white: 0xf5f5f5,
  red: 0x7a1f2b,
  redDark: 0x4a121a,
  graphite: 0x2a2a33,
};

export class PedidoAnimacao {
  constructor() {
    this.container = null;
    this.status = null;

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.clock = new THREE.Clock();

    this.raf = null;
    this.running = false;
    this.visible = true;
    this.webglAvailable = true;
    this.reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    this.resizeObserver = null;
    this.intersectionObserver = null;

    this.transition = null;
    this.disposables = [];
  }

  /* ----------------------------------------------------------
     API PÚBLICA
     ---------------------------------------------------------- */
  iniciar(container, status) {
    if (this.container) {
      // Já inicializado: apenas atualiza o estado.
      this.atualizarStatus(status);
      return;
    }

    this.container = container;
    this.status = this._resolveStatus(status);

    this._setupRenderer();
    if (!this.webglAvailable) return;

    this._buildScene();

    this.resizeObserver = new ResizeObserver(() => this._resize());
    this.resizeObserver.observe(container);
    this._resize();

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        this.visible = entries[0].isIntersecting;
        this._syncLoop();
      },
      { threshold: 0.02 }
    );
    this.intersectionObserver.observe(container);

    document.addEventListener("visibilitychange", this._onVisibility);
    window.addEventListener("resize", this._resize);

    this._applyState(this.status, { immediate: true });

    if (this.reducedMotion) {
      this._renderFrame();
    } else {
      this._syncLoop();
    }
  }

  atualizarStatus(novoStatus) {
    const resolved = this._resolveStatus(novoStatus);
    if (!this.container || resolved === this.status) return;

    this.status = resolved;
    this._applyState(resolved, { immediate: false });
    this._syncLoop();
  }

  destruir() {
    this.running = false;
    cancelAnimationFrame(this.raf);

    document.removeEventListener("visibilitychange", this._onVisibility);
    window.removeEventListener("resize", this._resize);

    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.intersectionObserver) this.intersectionObserver.disconnect();

    this._disposeAll();

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss?.();
      if (this.renderer.domElement?.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
      this.renderer = null;
    }

    this.scene = null;
    this.camera = null;
    this.container = null;
  }

  /* ----------------------------------------------------------
     RESOLUÇÃO DE STATUS (aceita o estado canônico ou aliases)
     ---------------------------------------------------------- */
  _resolveStatus(status) {
    const aliases = {
      PENDING: "pending",
      DELIVERED: "delivered",
      CANCELLED: "cancelled",
      pendente: "pending",
      entregue: "delivered",
      cancelado: "cancelled",
    };
    return aliases[status] || status;
  }

  /* ----------------------------------------------------------
     RENDERER / CENA
     ---------------------------------------------------------- */
  _setupRenderer() {
    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.domElement.className = "pedido-animacao__canvas";
      this.container.prepend(this.renderer.domElement);
    } catch (err) {
      this.webglAvailable = false;
      this.container.classList.add("pedido-animacao--fallback");
    }
  }

  _buildScene() {
    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    this.camera.position.set(0, 0, 5.2);
    this.camera.lookAt(0, 0, 0);

    // Iluminação
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(3, 4, 5);
    this.scene.add(key);

    const rim = new THREE.PointLight(COLOR.purple, 1.4, 20);
    rim.position.set(-3, 1, 2.5);
    this.scene.add(rim);

    this.pulseLight = new THREE.PointLight(COLOR.gold, 0, 12);
    this.pulseLight.position.set(0, 0, 2.4);
    this.scene.add(this.pulseLight);

    // Grupo principal (cartão + símbolos + partículas)
    this.root = new THREE.Group();
    this.scene.add(this.root);

    this._buildCard();
    this._buildRing();
    this._buildOrbitPoints();
    this._buildCheck();
    this._buildCross();
    this._buildWave();
    this._buildParticles();
  }

  _buildCard() {
    this.cardGroup = new THREE.Group();

    const bodyGeo = new THREE.BoxGeometry(1.7, 2.3, 0.06);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: COLOR.gold,
      metalness: 0.75,
      roughness: 0.32,
      emissive: 0x241a00,
      emissiveIntensity: 0.4,
    });
    this.cardBody = new THREE.Mesh(bodyGeo, bodyMat);
    this.cardGroup.add(this.cardBody);

    // Face frontal com detalhe roxo
    const accentGeo = new THREE.PlaneGeometry(1.42, 2.02);
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x1b1530,
      metalness: 0.6,
      roughness: 0.4,
      emissive: COLOR.purple,
      emissiveIntensity: 0.35,
    });
    const accent = new THREE.Mesh(accentGeo, accentMat);
    accent.position.z = 0.035;
    this.cardGroup.add(accent);

    // Contorno dourado
    const edgeGeo = new THREE.EdgesGeometry(bodyGeo);
    const edgeMat = new THREE.LineBasicMaterial({
      color: COLOR.goldSoft,
      transparent: true,
      opacity: 0.9,
    });
    const edge = new THREE.LineSegments(edgeGeo, edgeMat);
    this.cardGroup.add(edge);

    this.cardGroup.position.y = 0;
    this.root.add(this.cardGroup);

    this._track(bodyGeo, bodyMat, accentGeo, accentMat, edgeGeo, edgeMat);
  }

  _buildRing() {
    const geo = new THREE.TorusGeometry(1.5, 0.012, 8, 80, Math.PI * 1.15);
    const mat = new THREE.MeshBasicMaterial({
      color: COLOR.gold,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.ring = new THREE.Mesh(geo, mat);
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.z = -0.2;
    this.root.add(this.ring);
    this._track(geo, mat);
  }

  _buildOrbitPoints() {
    this.orbitGroup = new THREE.Group();
    const geo = new THREE.SphereGeometry(0.035, 10, 10);
    const mat = new THREE.MeshBasicMaterial({ color: COLOR.goldSoft });
    this.orbitDots = [];

    for (let i = 0; i < 7; i += 1) {
      const dot = new THREE.Mesh(geo, mat);
      const angle = (i / 7) * Math.PI * 2;
      const radius = 1.65 + (i % 2) * 0.12;
      dot.position.set(Math.cos(angle) * radius, Math.sin(angle) * 0.28, Math.sin(angle) * radius);
      this.orbitGroup.add(dot);
      this.orbitDots.push(dot);
    }

    this.root.add(this.orbitGroup);
    this._track(geo, mat);
  }

  _buildCheck() {
    this.check = new THREE.Group();

    const bar1 = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.16, 0.06),
      new THREE.MeshStandardMaterial({
        color: COLOR.gold,
        emissive: COLOR.gold,
        emissiveIntensity: 0.8,
        metalness: 0.5,
        roughness: 0.3,
      })
    );
    bar1.position.set(-0.28, -0.05, 0.2);
    bar1.rotation.z = Math.PI / 4;

    const bar2 = new THREE.Mesh(
      new THREE.BoxGeometry(0.66, 0.16, 0.06),
      new THREE.MeshStandardMaterial({
        color: COLOR.gold,
        emissive: COLOR.gold,
        emissiveIntensity: 0.8,
        metalness: 0.5,
        roughness: 0.3,
      })
    );
    bar2.position.set(0.04, 0.18, 0.2);
    bar2.rotation.z = -Math.PI / 4;

    this.check.add(bar1, bar2);
    this.check.position.y = 1.7;
    this.check.scale.setScalar(0);
    this.root.add(this.check);

    this._track(bar1.geometry, bar1.material, bar2.geometry, bar2.material);
  }

  _buildCross() {
    this.cross = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: COLOR.red,
      emissive: COLOR.red,
      emissiveIntensity: 0.5,
      metalness: 0.4,
      roughness: 0.4,
    });

    const a = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.14, 0.06), mat);
    a.rotation.z = Math.PI / 4;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.14, 0.06), mat);
    b.rotation.z = -Math.PI / 4;

    this.cross.add(a, b);
    this.cross.scale.setScalar(0);
    this.root.add(this.cross);

    this._track(a.geometry, b.geometry, mat);
  }

  _buildWave() {
    const geo = new THREE.RingGeometry(0.92, 1, 64);
    const mat = new THREE.MeshBasicMaterial({
      color: COLOR.gold,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.wave = new THREE.Mesh(geo, mat);
    this.wave.position.z = 0.1;
    this.wave.scale.setScalar(1);
    this.root.add(this.wave);
    this._track(geo, mat);
  }

  _buildParticles() {
    this.particleGroup = new THREE.Group();
    const count = 48;
    const positions = new Float32Array(count * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: COLOR.gold,
      size: 0.05,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.particles = new THREE.Points(geo, mat);
    this.particleVelocities = [];

    for (let i = 0; i < count; i += 1) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 0.9 + Math.random() * 0.3;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
      this.particleVelocities.push({
        x: (Math.random() - 0.5) * 2.2,
        y: (Math.random() - 0.5) * 2.2,
        z: (Math.random() - 0.5) * 2.2,
      });
    }

    this.particleGroup.add(this.particles);
    this.root.add(this.particleGroup);
    this._track(geo, mat);
  }

  /* ----------------------------------------------------------
     ESTADOS VISUAIS
     ---------------------------------------------------------- */
  _applyState(state, { immediate }) {
    if (!this.webglAvailable) return;

    this._resetStateVisuals();

    if (state === "pending") {
      this.transition = null;
      this._enterPending();
    } else if (state === "delivered") {
      this._enterDelivered(immediate);
    } else if (state === "cancelled") {
      this._enterCancelled(immediate);
    }

    if (immediate && this.reducedMotion) {
      this._renderFrame();
    }
  }

  _resetStateVisuals() {
    this.wave.material.opacity = 0;
    this.wave.material.color.setHex(COLOR.gold);
    this.wave.scale.setScalar(1);
    this.particles.material.opacity = 0;
    this.check.scale.setScalar(0);
    this.cross.scale.setScalar(0);

    const base = this.cardBody.material;
    base.color.setHex(COLOR.gold);
    base.emissive.setHex(0x241a00);
    base.emissiveIntensity = 0.4;
    base.metalness = 0.75;
    base.roughness = 0.32;

    this.cardGroup.scale.setScalar(1);
    this.ring.visible = false;
    this.orbitGroup.visible = false;

    this._resetParticles();
  }

  _resetParticles() {
    const pos = this.particles.geometry.attributes.position;
    const arr = pos.array;
    for (let i = 0; i < this.particleVelocities.length; i += 1) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 0.9 + Math.random() * 0.3;
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      arr[i * 3 + 2] = r * Math.cos(phi);
    }
    pos.needsUpdate = true;
  }

  _enterPending() {
    this.ring.visible = true;
    this.orbitGroup.visible = true;
    this.cardGroup.rotation.set(0, 0, 0);
    this.cardGroup.position.set(0, 0, 0);
    this.cardGroup.scale.setScalar(1);
  }

  _enterDelivered(immediate) {
    this.ring.visible = false;
    this.orbitGroup.visible = false;

    if (immediate) {
      this.cardGroup.rotation.set(0, 0, 0);
      this.cardGroup.position.set(0, 0, 0);
      this.check.scale.setScalar(1);
      return;
    }

    this.cardGroup.rotation.y = 0.5;
    this.cardGroup.rotation.z = -0.18;
    this.transition = {
      type: "delivered",
      start: this.clock.getElapsedTime(),
      duration: 2.2,
    };
  }

  _enterCancelled(immediate) {
    this.ring.visible = false;
    this.orbitGroup.visible = false;

    if (immediate) {
      this.cardBody.material.color.setHex(COLOR.graphite);
      this.cardBody.material.emissiveIntensity = 0;
      this.cross.scale.setScalar(1);
      return;
    }

    this.transition = {
      type: "cancelled",
      start: this.clock.getElapsedTime(),
      duration: 2.2,
    };
  }

  /* ----------------------------------------------------------
     LOOP DE ANIMAÇÃO
     ---------------------------------------------------------- */
  _onVisibility = () => {
    this._syncLoop();
  };

  _resize = () => {
    if (!this.renderer || !this.container) return;

    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  _syncLoop() {
    const active = this.visible && !document.hidden;

    if (active && !this.running && !this.reducedMotion) {
      this.running = true;
      this.clock.getDelta(); // descarta o intervalo acumulado
      this.raf = requestAnimationFrame(this._tick);
    } else if (!active && this.running) {
      this.running = false;
      cancelAnimationFrame(this.raf);
    }
  }

  _tick = () => {
    if (!this.running) return;

    const t = this.clock.getElapsedTime();
    this._update(t);
    this._renderFrame();

    this.raf = requestAnimationFrame(this._tick);
  };

  _update(t) {
    if (this.transition) {
      const p = Math.min((t - this.transition.start) / this.transition.duration, 1);
      if (this.transition.type === "delivered") {
        this._updateDelivered(p);
      } else if (this.transition.type === "cancelled") {
        this._updateCancelled(p);
      }

      if (p >= 1) {
        this.transition = null;
      }
      return;
    }

    // Estado estável
    if (this.status === "pending") {
      this._updatePending(t);
    } else if (this.status === "delivered") {
      this._updateDeliveredIdle(t);
    } else if (this.status === "cancelled") {
      this._updateCancelledIdle(t);
    }
  }

  _updatePending(t) {
    this.cardGroup.position.y = Math.sin(t * 1.6) * 0.18;
    this.cardGroup.rotation.y = Math.sin(t * 0.5) * 0.4;

    this.ring.rotation.z = t * 1.4;
    this.ring.material.opacity = 0.35 + Math.sin(t * 2.4) * 0.2;

    this.orbitGroup.rotation.y = t * 0.7;

    this.pulseLight.intensity = 1.1 + Math.sin(t * 2.6) * 0.6;
  }

  _updateDelivered(p) {
    const ease = this._easeOutCubic(p);

    // 1-3. Endireita o cartão e centraliza.
    this.cardGroup.rotation.y = 0.5 * (1 - ease);
    this.cardGroup.rotation.z = -0.18 * (1 - ease);

    // 4. Onda luminosa expansiva.
    const waveStart = 0.45;
    const wp = this._seg(p, waveStart, 1);
    this.wave.material.opacity = wp > 0 ? (1 - wp) * 0.9 : 0;
    this.wave.scale.setScalar(1 + wp * 2.6);

    // 5. Partículas douradas dispersam.
    const partStart = 0.4;
    const pp = this._seg(p, partStart, 1);
    this._updateParticles(pp);

    // 6. Símbolo de confirmação.
    const checkStart = 0.55;
    const cp = this._easeOutBack(this._seg(p, checkStart, 1));
    this.check.scale.setScalar(cp);

    // Luz dourada percorre as bordas (brilho no pulso).
    this.pulseLight.intensity = 0.6 + Math.sin(p * Math.PI) * 2.2;
  }

  _updateDeliveredIdle(t) {
    this.cardGroup.rotation.y = Math.sin(t * 0.4) * 0.12;
    this.cardGroup.position.y = Math.sin(t * 1.2) * 0.06;
    this.pulseLight.intensity = 1 + Math.sin(t * 2) * 0.3;
  }

  _updateCancelled(p) {
    // 1-2. Iluminação dourada diminui e dessatura.
    const desat = this._easeInOut(p);
    this.cardBody.material.color.lerpColors(
      new THREE.Color(COLOR.gold),
      new THREE.Color(COLOR.graphite),
      desat
    );
    this.cardBody.material.emissiveIntensity = 0.4 * (1 - desat);
    this.cardBody.material.metalness = 0.75 - desat * 0.4;
    this.pulseLight.intensity = Math.max(0, 1.2 * (1 - desat));

    // 3-4. Onda vermelha atravessa a cena.
    const waveStart = 0.45;
    const wp = this._seg(p, waveStart, 1);
    this.wave.material.color.setHex(COLOR.redDark);
    this.wave.material.opacity = wp > 0 ? (1 - wp) * 0.75 : 0;
    this.wave.scale.setScalar(1 + wp * 2.2);

    // 5. Desfaz em partículas.
    const partStart = 0.55;
    const pp = this._seg(p, partStart, 1);
    this.cardGroup.scale.setScalar(Math.max(0, 1 - pp * 1.05));
    this._updateParticles(pp);

    // 6. Símbolo de cancelamento.
    const crossStart = 0.7;
    const cp = this._easeOutBack(this._seg(p, crossStart, 1));
    this.cross.scale.setScalar(cp);
  }

  _updateCancelledIdle(t) {
    this.cardGroup.rotation.y = Math.sin(t * 0.3) * 0.1;
    this.cross.scale.setScalar(1);
  }

  _updateParticles(p) {
    if (p <= 0) {
      this.particles.material.opacity = 0;
      return;
    }

    this.particles.material.opacity = Math.max(0, 1 - p * 1.4);

    const pos = this.particles.geometry.attributes.position;
    const arr = pos.array;
    for (let i = 0; i < this.particleVelocities.length; i += 1) {
      const v = this.particleVelocities[i];
      arr[i * 3] += v.x * 0.02;
      arr[i * 3 + 1] += v.y * 0.02;
      arr[i * 3 + 2] += v.z * 0.02;
    }
    pos.needsUpdate = true;
  }

  _renderFrame() {
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /* ----------------------------------------------------------
     UTILITÁRIOS
     ---------------------------------------------------------- */
  _track(...items) {
    this.disposables.push(...items);
  }

  _disposeAll() {
    for (const item of this.disposables) {
      item?.dispose?.();
    }
    this.disposables = [];
  }

  _seg(p, start, end) {
    return THREE.MathUtils.clamp((p - start) / (end - start), 0, 1);
  }

  _easeOutCubic(x) {
    return 1 - Math.pow(1 - x, 3);
  }

  _easeInOut(x) {
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }

  _easeOutBack(x) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  }
}
