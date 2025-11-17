<script>
  import { onMount } from 'svelte';

  onMount(() => {
    const navToggle = document.getElementById('navToggle');
    const navLinks = document.getElementById('navLinks');

    if (!navToggle || !navLinks) return;

    // Toggle mobile menu
    function toggleMenu() {
      const isOpen = navLinks.classList.contains('open');

      if (isOpen) {
        navLinks.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      } else {
        navLinks.classList.add('open');
        navToggle.setAttribute('aria-expanded', 'true');
      }
    }

    navToggle.addEventListener('click', toggleMenu);

    // Close menu when clicking a link
    const links = navLinks.querySelectorAll('.nav-link');
    links.forEach((link) => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (
        !navToggle.contains(e.target) &&
        !navLinks.contains(e.target) &&
        navLinks.classList.contains('open')
      ) {
        navLinks.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      }
    });

    // Close menu on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && navLinks.classList.contains('open')) {
        navLinks.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
        navToggle.focus();
      }
    });

    // Setup smooth scroll
    const anchorLinks = document.querySelectorAll('a[href^="#"]');

    anchorLinks.forEach((link) => {
      link.addEventListener('click', (e) => {
        const href = link.getAttribute('href');

        if (href === '#') return;

        e.preventDefault();

        const targetId = href.substring(1);
        const target = document.getElementById(targetId);

        if (target) {
          const offsetTop = target.offsetTop - 70; // Account for fixed nav

          window.scrollTo({
            top: offsetTop,
            behavior: 'smooth'
          });
        }
      });
    });
  });
</script>

<!-- This component has no visual output, it just manages navigation interactions -->
