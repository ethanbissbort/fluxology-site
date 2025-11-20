<script>
  export let theme = 'corporate';

  import { onMount } from 'svelte';

  let particles = [];
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const particleCount = isMobile ? 8 : 15;

  onMount(() => {
    const isReducedMotion =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (isReducedMotion) {
      return; // Don't create particles if reduced motion is preferred
    }

    // Generate particles with random properties
    particles = Array.from({ length: particleCount }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 4 + 2,
      duration: Math.random() * 4 + 4,
      delay: Math.random() * 5
    }));
  });

  // Get particle class based on theme
  function getParticleClass(theme) {
    switch (theme) {
      case 'industrial':
        return 'spark-particle';
      case 'tech':
        return 'digital-particle';
      case 'natural':
        return 'leaf-particle';
      default:
        return 'particle';
    }
  }
</script>

<div class="particle-container" data-theme={theme}>
  {#each particles as particle (particle.id)}
    <div
      class={getParticleClass(theme)}
      style="
        left: {particle.x}%;
        top: {particle.y}%;
        width: {particle.size}px;
        height: {particle.size}px;
        --duration: {particle.duration}s;
        --delay: {particle.delay}s;
        --start-x: 0px;
        --start-y: 0px;
        --end-x: {(Math.random() - 0.5) * 200}px;
        --end-y: {-Math.random() * 500}px;
        --opacity: {Math.random() * 0.4 + 0.2};
      "
    />
  {/each}
</div>

<style>
  .particle-container {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
    contain: style paint;
  }

  /* Corporate theme particles */
  .particle {
    position: absolute;
    border-radius: 50%;
    background: rgba(58, 134, 255, 0.3);
    animation: particle-float var(--duration, 4s) var(--delay, 0s) infinite var(--ease-in-out-cubic);
  }

  @keyframes particle-float {
    0% {
      opacity: 0;
      transform: translate3d(var(--start-x, 0), var(--start-y, 0), 0) scale(0);
    }
    10% {
      opacity: var(--opacity, 0.6);
    }
    90% {
      opacity: var(--opacity, 0.6);
    }
    100% {
      opacity: 0;
      transform: translate3d(var(--end-x, 0), var(--end-y, 0), 0) scale(1);
    }
  }

  /* Industrial sparks */
  .spark-particle {
    position: absolute;
    border-radius: 50%;
    background: var(--industrial-accent-orange, #FF6B35);
    box-shadow: 0 0 10px var(--industrial-accent-orange, #FF6B35);
    animation: spark-fall var(--duration, 3s) var(--delay, 0s) infinite linear;
  }

  @keyframes spark-fall {
    0% {
      opacity: 1;
      transform: translate3d(var(--start-x, 0), 0, 0) scale(1);
    }
    100% {
      opacity: 0;
      transform: translate3d(var(--end-x, 0), 100vh, 0) scale(0.5);
    }
  }

  /* Tech digital particles */
  .digital-particle {
    position: absolute;
    width: 2px;
    height: 2px;
    background: var(--tech-accent-cyan, #00D9FF);
    box-shadow: 0 0 5px var(--tech-accent-cyan, #00D9FF);
    animation: digital-pulse var(--duration, 2s) var(--delay, 0s) infinite ease-in-out;
  }

  @keyframes digital-pulse {
    0%,
    100% {
      opacity: 0.2;
      transform: translate3d(0, 0, 0) scale(1);
    }
    50% {
      opacity: 1;
      transform: translate3d(0, 0, 0) scale(1.5);
    }
  }

  /* Natural leaf particles */
  .leaf-particle {
    position: absolute;
    width: 8px;
    height: 12px;
    background: rgba(107, 142, 107, 0.4);
    border-radius: 0 50% 50% 0;
    animation: leaf-float var(--duration, 8s) var(--delay, 0s) infinite ease-in-out;
  }

  @keyframes leaf-float {
    0% {
      opacity: 0;
      transform: translate3d(var(--start-x, 0), -20px, 0) rotate(0deg);
    }
    10% {
      opacity: 0.6;
    }
    90% {
      opacity: 0.6;
    }
    100% {
      opacity: 0;
      transform: translate3d(var(--end-x, 0), 100vh, 0) rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .particle,
    .spark-particle,
    .digital-particle,
    .leaf-particle {
      display: none !important;
    }
  }
</style>
