<script module lang="ts">
  // Single inline-SVG icon set (feather-style strokes) so every glyph in the
  // product shares one weight, size, and cap style. The table lives in module
  // scope so it is built once, not once per rendered icon.
  export type IconName =
    | 'plus'
    | 'minus'
    | 'home'
    | 'magnet'
    | 'history'
    | 'close'
    | 'trash'
    | 'lock'
    | 'download'
    | 'upload'
    | 'share'
    | 'copy'
    | 'shuffle'
    | 'dots'
    | 'sun'
    | 'moon'
    | 'check'
    | 'alert'
    | 'info'
    | 'chevron-down'
    | 'restore'
    | 'users'
    | 'sparkle'
    | 'grid'
    | 'arrow-right'
    | 'file'
    | 'printer'
    | 'tag'
    | 'layers'
    | 'hash'
    | 'cloud'
    | 'cloud-off';

  const paths: Record<IconName, string> = {
    plus: 'M12 5v14M5 12h14',
    cloud: 'M17.5 19a4.5 4.5 0 0 0 .5-8.97A6.5 6.5 0 0 0 5.2 11.2 3.9 3.9 0 0 0 6 19z',
    'cloud-off': 'M17.5 19a4.5 4.5 0 0 0 .5-8.97 6.5 6.5 0 0 0-1.2-3.02M6 19a3.9 3.9 0 0 1-.8-7.8 6.5 6.5 0 0 1 1.9-3.4M3 3l18 18',
    minus: 'M5 12h14',
    home: 'M3 10.5 12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5',
    magnet:
      'M6 3v7a6 6 0 0 0 12 0V3M6 3h4v4H6zM14 3h4v4h-4z',
    history: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7.5V12l3.5 2',
    close: 'M6 6l12 12M18 6 6 18',
    trash: 'M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v5M14 11v5',
    lock: 'M6 11h12v9H6zM9 11V7a3 3 0 0 1 6 0v4',
    download: 'M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 19h16',
    upload: 'M12 15V3m0 0 4.5 4.5M12 3 7.5 7.5M4 19h16',
    // Tray with an arrow leaving it — the OS share sheet, not the three-dot node
    // graph, which reads as "post to social media" rather than "send this file".
    share:
      'M12 3v12M8.5 6.5 12 3l3.5 3.5M8 10H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-2',
    copy: 'M10 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM6 16a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2',
    shuffle: 'M3 6h4l10 12h4m0 0-3-3m3 3-3 3M3 18h4l2.6-3.1M14.4 9.1 17 6h4m0 0-3-3m3 3-3 3',
    dots: 'M5 12h.01M12 12h.01M19 12h.01',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    moon: 'M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z',
    check: 'M4.5 12.5 10 18 19.5 7',
    alert: 'M12 3 2.5 20h19zM12 9.5V14M12 17h.01',
    info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
    'chevron-down': 'm6 9 6 6 6-6',
    restore: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
    users: 'M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6 6 0 0 1 12 0M15.5 4.6a3.5 3.5 0 0 1 0 5.8M17.5 14.6a6 6 0 0 1 4 5.4',
    sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9z',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    'arrow-right': 'M4 12h16m0 0-6-6m6 6-6 6',
    file: 'M6 3h8l4 4v14H6zM14 3v4h4',
    printer: 'M7 8V3h10v5M5 8h14a1 1 0 0 1 1 1v7h-4M4 9v7h4m-1-3h10v8H7z',
    tag: 'M3 11V3h8l10 10-8 8zM7.5 7.5h.01',
    layers: 'M12 3 3 8.5l9 5.5 9-5.5zM3 14l9 5.5 9-5.5',
    hash: 'M10 3.5 8 20.5M16 3.5l-2 17M4 9h17M3 15h17',
  };
</script>

<script lang="ts">
  let {
    name,
    size = 18,
    stroke = 2,
  }: { name: IconName; size?: number; stroke?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  <path d={paths[name]} />
</svg>
