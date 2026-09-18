import { state } from './state.js';
import { init } from './init.js';

/* ════════════════════════════════════════════
   CINEMATIC INTRO — movie-studio logo reveal
════════════════════════════════════════════ */
export function playCinematicIntro() {
  const intro = document.getElementById('cinematic-intro');
  intro.style.display = 'flex';

  // Particle background
  const canvas = document.getElementById('cine-canvas');
  const ctx = canvas.getContext('2d');
  let w = canvas.width = window.innerWidth;
  let h = canvas.height = window.innerHeight;

  const particles = [];
  for (let i = 0; i < 80; i++) {
    particles.push({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
      r: Math.random() * 1.5 + 0.5, alpha: Math.random() * 0.3 + 0.1,
    });
  }

  let cineFrame;
  function drawParticles() {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      // Connections
      for (let j = i + 1; j < particles.length; j++) {
        const q = particles[j];
        const dx = p.x - q.x, dy = p.y - q.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 120) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
          ctx.strokeStyle = `rgba(0, 87, 156, ${(1 - dist / 120) * 0.12})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
      // Dot
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 87, 156, ${p.alpha})`;
      ctx.fill();
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
    }
    cineFrame = requestAnimationFrame(drawParticles);
  }
  drawParticles();

  // Animate elements in sequence
  const content = document.getElementById('cine-content');
  const shield  = content.querySelector('.cine-shield');
  const line    = document.getElementById('cine-line');
  const name    = document.getElementById('cine-name');
  const sub     = document.getElementById('cine-sub');
  const tagline = document.getElementById('cine-tagline');

  // Fade in content container
  setTimeout(() => { content.style.transition = 'opacity .4s ease'; content.style.opacity = '1'; }, 100);

  // Shield scales in
  setTimeout(() => {
    shield.style.transition = 'opacity .4s ease, transform .4s ease';
    shield.style.opacity = '1'; shield.style.transform = 'scale(1)';
  }, 150);

  // Bank name types in
  setTimeout(() => {
    name.style.transition = 'opacity .3s ease, transform .3s ease';
    name.style.opacity = '1'; name.style.transform = 'translateY(0)';
  }, 400);

  // Red-blue line extends
  setTimeout(() => { line.style.width = '280px'; }, 500);

  // Sub text
  setTimeout(() => {
    sub.style.transition = 'opacity .3s ease, transform .3s ease';
    sub.style.opacity = '1'; sub.style.transform = 'translateY(0)';
  }, 700);

  // Tagline
  setTimeout(() => {
    tagline.style.transition = 'opacity .3s ease';
    tagline.style.opacity = '1';
  }, 900);

  // Hold for a beat, then fade out → loading screen
  setTimeout(() => {
    cancelAnimationFrame(cineFrame);
    intro.style.transition = 'opacity .4s ease';
    intro.style.opacity = '0';
    setTimeout(() => {
      intro.style.display = 'none';
      init();
    }, 400);
  }, 1500);
}

/* ════════════════════════════════════════════
   LOADING SCREEN — particle network animation
════════════════════════════════════════════ */
let loadAnimFrame = null;

export function startLoadingAnimation() {
  const canvas = document.getElementById('load-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w = canvas.width = window.innerWidth;
  let h = canvas.height = window.innerHeight;

  const particles = [];
  const PARTICLE_COUNT = 60;
  const CONNECTION_DIST = 150;

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6,
      r: Math.random() * 2 + 1,
    });
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);

    // Draw connections
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CONNECTION_DIST) {
          const alpha = (1 - dist / CONNECTION_DIST) * 0.15;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(0, 87, 156, ${alpha})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }

    // Draw particles
    for (const p of particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 87, 156, 0.4)';
      ctx.fill();

      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
    }

    loadAnimFrame = requestAnimationFrame(draw);
  }

  draw();

  // Show session info
  const infoEl = document.getElementById('load-session-info');
  if (infoEl && state.authUser) {
    const now = new Date();
    infoEl.textContent = `SESSION ${state.authUser.companyId} · ${state.authUser.name.toUpperCase()} · ${now.toISOString().replace('T',' ').slice(0,19)} UTC`;
  }
}

export function stopLoadingAnimation() {
  if (loadAnimFrame) {
    cancelAnimationFrame(loadAnimFrame);
    loadAnimFrame = null;
  }
}
