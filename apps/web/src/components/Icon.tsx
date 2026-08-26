import type { CSSProperties } from 'react';

/**
 * Icon set, hand-drawn as SVG paths on a 24x24 grid with a consistent
 * 1.8 stroke weight. Category glyphs read as the trade they represent
 * (a pipe, a plug, a saw) rather than a generic shape.
 */

export type IconName =
  | 'home' | 'search' | 'clipboard' | 'chat' | 'user' | 'grid' | 'users'
  | 'briefcase' | 'receipt' | 'bell' | 'settings' | 'back' | 'chevron'
  | 'plus' | 'check' | 'close' | 'calendar' | 'clock' | 'star' | 'star-filled'
  | 'phone' | 'mail' | 'map-pin' | 'shield' | 'file-text' | 'download'
  | 'whatsapp' | 'apple' | 'trash' | 'edit' | 'filter' | 'sun' | 'moon'
  | 'logout' | 'alert' | 'info' | 'lock' | 'sparkle' | 'trending'
  | 'plumbing' | 'electrical' | 'carpentry' | 'hvac' | 'painting'
  | 'cleaning' | 'repairs' | 'appliances' | 'wrench';

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
  style?: CSSProperties;
}

const PATHS: Record<IconName, { d: string; fill?: boolean }[]> = {
  /* ------------------------------- navigation ---------------------------- */
  home: [{ d: 'M3 10.2 12 3l9 7.2V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' }],
  search: [{ d: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16.2 16.2 21 21' }],
  clipboard: [
    { d: 'M9 4h6v3H9z' },
    { d: 'M9 5.5H6.5A1.5 1.5 0 0 0 5 7v12.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H15' },
    { d: 'M8.5 12h7M8.5 16h4' },
  ],
  chat: [{ d: 'M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4z' }],
  user: [
    { d: 'M12 11a3.6 3.6 0 1 0 0-7.2A3.6 3.6 0 0 0 12 11z' },
    { d: 'M4.5 20.5a7.5 7.5 0 0 1 15 0' },
  ],
  grid: [{ d: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z' }],
  users: [
    { d: 'M9.5 11a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z' },
    { d: 'M2.8 20a6.7 6.7 0 0 1 13.4 0' },
    { d: 'M16.5 5.2a3.2 3.2 0 0 1 0 6.1M18 14.2a6.7 6.7 0 0 1 3.2 5.8' },
  ],
  briefcase: [
    { d: 'M3.5 8.5h17v10a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z' },
    { d: 'M9 8.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v2.5' },
    { d: 'M3.5 13h17' },
  ],
  receipt: [
    { d: 'M5.5 3.5h13v17l-2.2-1.6-2.2 1.6-2.1-1.6L9.7 20.5l-2.1-1.6-2.1 1.6z' },
    { d: 'M9 8h6M9 12h6' },
  ],
  bell: [
    { d: 'M12 3.5a5.5 5.5 0 0 0-5.5 5.5c0 4.2-1.5 5.5-1.5 5.5h14s-1.5-1.3-1.5-5.5A5.5 5.5 0 0 0 12 3.5z' },
    { d: 'M10.2 18a2 2 0 0 0 3.6 0' },
  ],
  settings: [
    { d: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z' },
    { d: 'M19 12a7.3 7.3 0 0 0-.1-1.1l1.9-1.4-1.9-3.3-2.2.9a7 7 0 0 0-1.9-1.1L14.4 3H9.6l-.4 2a7 7 0 0 0-1.9 1.1l-2.2-.9-1.9 3.3 1.9 1.4a7.3 7.3 0 0 0 0 2.2l-1.9 1.4 1.9 3.3 2.2-.9a7 7 0 0 0 1.9 1.1l.4 2h4.8l.4-2a7 7 0 0 0 1.9-1.1l2.2.9 1.9-3.3-1.9-1.4c.07-.36.1-.73.1-1.1z' },
  ],

  /* --------------------------------- actions ----------------------------- */
  back: [{ d: 'M15 19 8 12l7-7' }],
  chevron: [{ d: 'm9 5 7 7-7 7' }],
  plus: [{ d: 'M12 5v14M5 12h14' }],
  check: [{ d: 'm5 12.5 4.5 4.5L19 7.5' }],
  close: [{ d: 'M6 6l12 12M18 6 6 18' }],
  calendar: [
    { d: 'M4.5 6.5h15v13a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z' },
    { d: 'M8 3.5v5M16 3.5v5M4.5 11h15' },
  ],
  clock: [{ d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2' }],
  star: [{ d: 'm12 3.8 2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.9z' }],
  'star-filled': [{ d: 'm12 3.8 2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.9z', fill: true }],
  phone: [{ d: 'M6.6 3.5h3l1.5 3.8-1.9 1.4a11 11 0 0 0 5.1 5.1l1.4-1.9 3.8 1.5v3a1.6 1.6 0 0 1-1.7 1.6A15.5 15.5 0 0 1 5 5.2a1.6 1.6 0 0 1 1.6-1.7z' }],
  mail: [
    { d: 'M3.5 5.5h17v13h-17z' },
    { d: 'm3.5 6.5 8.5 6 8.5-6' },
  ],
  'map-pin': [
    { d: 'M12 21s7-5.6 7-11a7 7 0 0 0-14 0c0 5.4 7 11 7 11z' },
    { d: 'M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z' },
  ],
  shield: [
    { d: 'M12 3 5 5.8v5.4c0 4.4 3 8 7 9.8 4-1.8 7-5.4 7-9.8V5.8z' },
    { d: 'm9 12 2.2 2.2L15.5 10' },
  ],
  'file-text': [
    { d: 'M6 3.5h7l5 5v12H6z' },
    { d: 'M13 3.5v5h5M9 13h6M9 16.5h4' },
  ],
  download: [{ d: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15' }],
  trash: [
    { d: 'M5 6.5h14M9.5 6.5V4.5h5v2' },
    { d: 'M6.5 6.5 7.4 20a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9l.9-13.5' },
  ],
  edit: [{ d: 'M4.5 19.5h4L19 9a2.1 2.1 0 0 0-3-3L4.5 15.5zM14.5 6.5l3 3' }],
  filter: [{ d: 'M3.5 5.5h17l-6.5 8v6l-4 2v-8z' }],
  sun: [
    { d: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z' },
    { d: 'M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4' },
  ],
  moon: [{ d: 'M20 14.2A8.4 8.4 0 0 1 9.8 4 8.5 8.5 0 1 0 20 14.2z' }],
  logout: [{ d: 'M14.5 16.5v2a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4H13a1.5 1.5 0 0 1 1.5 1.5v2M10 12h10M16.5 8.5 20 12l-3.5 3.5' }],
  alert: [{ d: 'M12 3.5 21 19.5H3zM12 10v4M12 16.6v.1' }],
  info: [{ d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.6v.1' }],
  lock: [
    { d: 'M6 10.5h12v9H6z' },
    { d: 'M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7' },
  ],
  sparkle: [{ d: 'm12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z' }],
  trending: [{ d: 'M3.5 17 9 11l4 4 7.5-8M15 7h5.5v5.5' }],

  /* ------------------------------- categories ---------------------------- */
  // Pipe elbow with a valve handle.
  plumbing: [
    { d: 'M7 3.5v6.5a4 4 0 0 0 4 4h6.5' },
    { d: 'M4.5 3.5h5M15 11.5h5v5h-5z' },
    { d: 'M12 17.5v3M9.5 20.5h5' },
  ],
  // Plug and lightning bolt.
  electrical: [
    { d: 'm13 3-6 8h4.5l-1.5 10 6.5-9H12z', fill: true },
    { d: 'M4 6.5h2M4 12h2M4 17.5h2' },
  ],
  // Handsaw over a plank.
  carpentry: [
    { d: 'M3.5 15.5 14 5l4.5 4.5L8 20z' },
    { d: 'm14.5 4.5 1.8-1.8 3.5 3.5-1.8 1.8' },
    { d: 'm6 13 1.5 1.5M8.5 10.5 10 12M11 8l1.5 1.5' },
  ],
  // Wall-mounted air conditioning unit with airflow.
  hvac: [
    { d: 'M3.5 5h17v6h-17z' },
    { d: 'M6.5 8h11' },
    { d: 'M7 14.5c0 1.5 1.5 1.5 1.5 3M12 14.5c0 1.5 1.5 1.5 1.5 3M17 14.5c0 1.5-1.5 1.5-1.5 3' },
  ],
  // Paint roller with tray.
  painting: [
    { d: 'M5 4.5h11v4H5z' },
    { d: 'M16 6.5h3v4h-8v3' },
    { d: 'M9.5 13.5h3v7h-3z' },
  ],
  // Spray bottle with droplets.
  cleaning: [
    { d: 'M9 8.5h5.5v12H9z' },
    { d: 'M10.5 8.5v-3h3v3M13.5 6.5H18' },
    { d: 'M19.5 4.5v.1M20.5 8v.1M18 10.5v.1' },
  ],
  // Wrench crossed with a screwdriver.
  repairs: [
    {
      d: 'M13.9 7.1a.9.9 0 0 0 0 1.2l1.4 1.4a.9.9 0 0 0 1.2 0l3.2-3.2a5.2 5.2 0 0 1-6.8 6.8l-4.1 4.1a1.8 1.8 0 0 1-2.6-2.6l4.1-4.1a5.2 5.2 0 0 1 6.8-6.8z',
    },
    { d: 'm4.5 4.5 3.2 3.2M16.5 16.5l3.4 3.4' },
  ],
  // Front-loading washing machine.
  appliances: [
    { d: 'M4.5 3.5h15v17h-15z' },
    { d: 'M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z' },
    { d: 'M7.5 6.5h.1M10.5 6.5h.1' },
  ],
  // Open-end wrench: jaw at the top, handle running to the lower left.
  wrench: [{
    d: 'M14.6 6.4a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.7-3.7a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z',
  }],

  /* --------------------------------- brands ------------------------------ */
  whatsapp: [{
    d: 'M12 3.5a8.4 8.4 0 0 0-7.2 12.7L3.6 20.5l4.4-1.2A8.4 8.4 0 1 0 12 3.5zm4.6 11.8c-.2.6-1.1 1.1-1.6 1.1-.4 0-.9.2-3-.7-2.5-1.1-4.1-3.7-4.2-3.9-.1-.2-1-1.4-1-2.6s.6-1.8.9-2.1c.2-.2.5-.3.6-.3h.5c.2 0 .4 0 .5.4l.8 1.9c.1.2 0 .4-.1.5l-.4.5c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.1 1 2.1 1.3 2.4 1.4.2.1.4.1.5-.1l.7-.9c.2-.2.4-.1.6 0l1.8.9c.2.1.4.2.4.3z',
    fill: true,
  }],
  apple: [{
    d: 'M16.3 12.6c0-2 1.6-2.9 1.7-3-1-1.4-2.4-1.6-2.9-1.6-1.3-.1-2.5.7-3.1.7s-1.6-.7-2.7-.7c-1.4 0-2.7.8-3.4 2-1.4 2.5-.4 6.2 1 8.2.7 1 1.5 2.1 2.5 2.1s1.4-.6 2.6-.6 1.5.6 2.6.6 1.8-1 2.5-2c.8-1.1 1.1-2.2 1.1-2.3 0 0-2.1-.8-2.1-3.2zM14.2 6.2c.5-.7.9-1.6.8-2.6-.8 0-1.8.6-2.4 1.2-.5.6-1 1.6-.8 2.5.9.1 1.8-.4 2.4-1.1z',
    fill: true,
  }],
};

export function Icon({ name, size = 22, className, strokeWidth = 1.8, style }: IconProps) {
  const paths = PATHS[name] ?? PATHS.wrench;
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={style}
      // Decorative by default: the accessible name comes from the control
      // that wraps the icon, so a screen reader is not told "star star star".
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((path, i) => (
        <path
          key={i}
          d={path.d}
          stroke={path.fill ? 'none' : 'currentColor'}
          fill={path.fill ? 'currentColor' : 'none'}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

/** Maps a category slug from the API to its glyph. */
export function categoryIcon(slug: string): IconName {
  const map: Record<string, IconName> = {
    plumbing: 'plumbing',
    electrical: 'electrical',
    carpentry: 'carpentry',
    hvac: 'hvac',
    painting: 'painting',
    cleaning: 'cleaning',
    repairs: 'repairs',
    appliances: 'appliances',
  };
  return map[slug] ?? 'wrench';
}
