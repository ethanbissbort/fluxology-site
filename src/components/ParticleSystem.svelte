<script>
  import { onMount } from 'svelte';

  // `variant` picks the particle style directly ('spark' | 'digital' |
  // 'leaf' | 'mist' | 'dot'); when omitted it derives from the theme.
  // This lets greenhouse use mist droplets while orchard keeps falling
  // leaves, even though both share the 'natural' theme.
  let { theme = 'corporate', variant = null } = $props();

  const themeDefaults = {
    industrial: 'spark',
    tech: 'digital',
    natural: 'leaf'
  };
  const kind = variant ?? themeDefaults[theme] ?? 'dot';

  const kindClass = {
    spark: 'spark-particle',
    digital: 'digital-particle',
    leaf: 'leaf-particle',
    mist: 'mist-particle',
    dot: 'particle'
  }[kind];

  // Size/tempo envelopes per particle kind: mist wants large, slow, soft
  // puffs; leaves are bigger and drift longer than sparks.
  const geometry = {
    spark:   { size: [2, 6],  duration: [4, 8],   delay: [0, 5] },
    digital: { size: [2, 6],  duration: [4, 8],   delay: [0, 5] },
    leaf:    { size: [8, 14], duration: [6, 11],  delay: [0, 6] },
    mist:    { size: [8, 20], duration: [8, 14],  delay: [0, 7] },
    dot:     { size: [2, 6],  duration: [4, 8],   delay: [0, 5] }
  }[kind];

  let particles = $state([]);
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const particleCount = isMobile ? 8 : 15;

  const rand = ([min, max]) => Math.random() * (max - min) + min;

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
      size: rand(geometry.size),
      duration: rand(geometry.duration),
      delay: rand(geometry.delay)
    }));
  });
</script>

<div class="particle-container" data-theme={theme}>
  {#each particles as particle (particle.id)}
    <div
      class={kindClass}
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
    ></div>
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

  /* Natural leaf particles (orchard: falling leaves) */
  .leaf-particle {
    position: absolute;
    background: rgba(107, 142, 107, 0.4);
    /* Leaf silhouette: pointed stem corner, rounded blade */
    border-radius: 0 60% 45% 60%;
    animation: leaf-float var(--duration, 8s) var(--delay, 0s) infinite ease-in-out;
  }

  /* Greenhouse mist droplets: soft blurred puffs that rise and drift */
  .mist-particle {
    position: absolute;
    border-radius: 50%;
    background: radial-gradient(
      circle,
      rgba(245, 241, 232, 0.45) 0%,
      rgba(139, 168, 136, 0.18) 55%,
      transparent 75%
    );
    filter: blur(1.5px);
    animation: mist-rise var(--duration, 10s) var(--delay, 0s) infinite ease-in-out;
  }

  @keyframes mist-rise {
    0% {
      opacity: 0;
      transform: translate3d(0, 40px, 0) scale(0.8);
    }
    20% {
      opacity: var(--opacity, 0.4);
    }
    80% {
      opacity: var(--opacity, 0.4);
    }
    100% {
      opacity: 0;
      transform: translate3d(var(--end-x, 20px), -160px, 0) scale(1.2);
    }
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
    .leaf-particle,
    .mist-particle {
      display: none !important;
    }
  }
</style>
