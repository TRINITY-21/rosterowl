<script lang="ts">
  let { size = 28 }: { size?: number } = $props();
</script>

<!-- The RosterOwl mark: a marigold owl (never green — that owl is taken). -->
<svg
  width={size}
  height={size}
  viewBox="0 0 64 64"
  fill="none"
  aria-hidden="true"
>
  <!-- body -->
  <path
    d="M12 30c0-11 9-20 20-20s20 9 20 20v10c0 8.8-7.2 16-16 16h-8c-8.8 0-16-7.2-16-16V30Z"
    fill="#e8a03c"
  />
  <!-- ear tufts -->
  <path d="M15 15 L24 11 L21 20 Z" fill="#e8a03c" />
  <path d="M49 15 L40 11 L43 20 Z" fill="#e8a03c" />
  <!-- glasses-style eyes (a nod to Atkinson Hyperlegible) -->
  <circle cx="23.5" cy="30" r="8.5" fill="#fdfcf8" />
  <circle cx="40.5" cy="30" r="8.5" fill="#fdfcf8" />
  <rect x="30.5" y="28.8" width="3" height="2.4" rx="1.2" fill="#243230" />
  <circle cx="23.5" cy="30" r="3.6" fill="#243230" />
  <circle cx="40.5" cy="30" r="3.6" fill="#243230" />
  <circle cx="24.8" cy="28.8" r="1.2" fill="#fdfcf8" />
  <circle cx="41.8" cy="28.8" r="1.2" fill="#fdfcf8" />
  <!-- beak -->
  <path d="M32 37 L28.5 42.5 L35.5 42.5 Z" fill="#c9822a" />
  <!-- belly feathers -->
  <path
    d="M24 48c2.5-2 5.5-2 8 0 2.5-2 5.5-2 8 0"
    stroke="#c9822a"
    stroke-width="2"
    stroke-linecap="round"
    fill="none"
  />
</svg>
