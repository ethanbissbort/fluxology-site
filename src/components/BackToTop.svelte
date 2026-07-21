<script>
  import { onMount } from 'svelte';

  let visible = $state(false);

  function scrollToTop() {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }

  onMount(() => {
    let ticking = false;

    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          visible = window.scrollY > 500;
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => window.removeEventListener('scroll', handleScroll);
  });
</script>

<button
  class="back-to-top"
  class:visible
  onclick={scrollToTop}
  aria-label="Back to top"
>
  <span class="back-to-top-arrow">↑</span>
</button>

<style>
  .back-to-top {
    position: fixed;
    bottom: var(--spacing-xl);
    right: var(--spacing-xl);
    width: 50px;
    height: 50px;
    background: var(--current-accent-primary, #3A86FF);
    color: white;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-xl);
    cursor: pointer;
    opacity: 0;
    visibility: hidden;
    transition: all var(--transition-base) var(--ease-out-cubic);
    z-index: var(--z-navigation);
    box-shadow: var(--shadow-lg);
    border: none;
  }

  .back-to-top.visible {
    opacity: 1;
    visibility: visible;
  }

  .back-to-top:hover,
  .back-to-top:focus {
    transform: translateY(-3px);
    box-shadow: var(--shadow-xl);
  }

  .back-to-top-arrow {
    line-height: 1;
  }

  @media (max-width: 767px) {
    .back-to-top {
      bottom: var(--spacing-md);
      right: var(--spacing-md);
      width: 44px;
      height: 44px;
      font-size: var(--font-size-lg);
    }
  }
</style>
