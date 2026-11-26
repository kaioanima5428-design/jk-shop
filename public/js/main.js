/* ============================================================
   PASSE BOOYAH — LANDING PAGE
   Interações leves: partículas do hero, tratamento de imagens
   reservadas e gatilho do fluxo de compra.
   ============================================================ */

const prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
).matches;

/* ------------------------------------------------------------
   1. Partículas discretas no fundo do banner (Canvas 2D)
   ------------------------------------------------------------ */
class HeroParticles {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.particles = [];
    this.raf = null;
    this.running = false;
    this.visible = false;
    this.isIntersecting = true;

    this.resize = this.resize.bind(this);
    this.tick = this.tick.bind(this);
    this.update = this.update.bind(this);
    this.onVisibilityChange = this.update;

    this.count = this.estimateCount();
  }

  estimateCount() {
    // Poucas partículas para manter o desempenho em aparelhos simples.
    const width = this.canvas.clientWidth || window.innerWidth;
    return Math.max(18, Math.min(46, Math.round(width / 18)));
  }

  start() {
    if (prefersReducedMotion) return;

    this.resize();
    window.addEventListener("resize", this.resize);

    this.observer = new IntersectionObserver(
      (entries) => {
        this.isIntersecting = entries[0].isIntersecting;
        this.update();
      },
      { threshold: 0.05 }
    );
    this.observer.observe(this.canvas);

    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();

    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.width = rect.width;
    this.height = rect.height;

    this.build();
  }

  build() {
    this.particles = [];
    const count = Math.min(this.count, Math.round(this.width / 16));

    for (let i = 0; i < count; i += 1) {
      this.particles.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        r: 0.6 + Math.random() * 1.6,
        speed: 0.15 + Math.random() * 0.5,
        drift: (Math.random() - 0.5) * 0.2,
        alpha: 0.15 + Math.random() * 0.4,
        hue: Math.random() < 0.8 ? "255, 196, 0" : "139, 53, 245",
      });
    }
  }

  update() {
    this.visible = this.isIntersecting && !document.hidden;
    this.sync();
  }

  sync() {
    if (this.visible && !this.running) {
      this.running = true;
      this.raf = requestAnimationFrame(this.tick);
    } else if (!this.visible && this.running) {
      this.running = false;
      cancelAnimationFrame(this.raf);
    }
  }

  tick() {
    if (!this.running) return;

    this.ctx.clearRect(0, 0, this.width, this.height);

    for (const p of this.particles) {
      p.y -= p.speed;
      p.x += p.drift + Math.sin(p.y * 0.02) * 0.15;

      if (p.y < -8) {
        p.y = this.height + 8;
        p.x = Math.random() * this.width;
      }
      if (p.x < -8) p.x = this.width + 8;
      if (p.x > this.width + 8) p.x = -8;

      this.ctx.beginPath();
      this.ctx.fillStyle = `rgba(${p.hue}, ${p.alpha})`;
      this.ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.raf = requestAnimationFrame(this.tick);
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    if (this.observer) this.observer.disconnect();
  }
}

/* ------------------------------------------------------------
   2. Imagens reservadas (não quebrar o layout antes dos assets)
   ------------------------------------------------------------ */
function handleReservedImages() {
  const images = document.querySelectorAll(".hero__image, .rewards__image");

  images.forEach((img) => {
    img.addEventListener("error", () => {
      // Mantém o container/placeholder atmosférico até a imagem real chegar.
      img.style.display = "none";
    });

    img.addEventListener("load", () => {
      img.style.display = "block";
    });
  });
}

/* ------------------------------------------------------------
   3. Fluxo de compra e verificação do UID do jogador
   ------------------------------------------------------------ */
function initPurchaseFlow() {
  const button = document.getElementById("comprar-passe");
  if (!button) return;

  // Leva para a etapa de coleta do UID e confirmação da conta.
  button.addEventListener("click", () => {
    window.location.href = "comprar.html";
  });
}

/* ------------------------------------------------------------
   Bootstrap
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.querySelector(".hero-particles");
  if (canvas) {
    const particles = new HeroParticles(canvas);
    particles.start();
    // Permite testes manuais via console e limpeza futura.
    window.__heroParticles = particles;
  }

  handleReservedImages();
  initPurchaseFlow();
});
