<script>
  import { onMount } from 'svelte';

  let progress = 0;

  function updateProgress() {
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    const scrollTop = window.scrollY;
    progress = (scrollTop / (documentHeight - windowHeight)) * 100;
  }

  onMount(() => {
    let ticking = false;

    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          updateProgress();
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    updateProgress();

    return () => window.removeEventListener('scroll', handleScroll);
  });
</script>

<div
  class="scroll-progress"
  role="progressbar"
  aria-valuenow={Math.round(progress)}
  aria-valuemin="0"
  aria-valuemax="100"
>
  <div class="scroll-progress-bar" style="width: {progress}%"></div>
</div>

<style>
  .scroll-progress {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 3px;
    background: rgba(255, 255, 255, 0.1);
    z-index: var(--z-navigation);
    pointer-events: none;
  }

  .scroll-progress-bar {
    height: 100%;
    background: var(--current-accent-primary, #3A86FF);
    transition: width 0.1s linear, background-color var(--transition-theme) var(--ease-in-out-cubic);
  }
</style>
