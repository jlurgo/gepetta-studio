const PATHS = {
  camera: "M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  play: "M7 5v14l12-7Z",
  stop: "M6 6h12v12H6Z",
  tag: "M3 12V4h8l10 10-8 8Z M7.5 8.5a1 1 0 1 0 0-.01",
  record: "M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z",
  pause: "M7 5h3v14H7Z M14 5h3v14h-3Z",
  tail: "M4 5v14 M9 5v14l11-7Z",
  loop: "M17 2l3 3-3 3 M4 11V9a4 4 0 0 1 4-4h12 M7 22l-3-3 3-3 M20 13v2a4 4 0 0 1-4 4H4",
  onion: "M9 12a5 5 0 1 0 10 0 5 5 0 0 0-10 0Z M5 12a5 5 0 0 1 5-5 M3 12a7 7 0 0 1 7-7",
  trash: "M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3",
  copy: "M8 8h11v11H8Z M5 16V5h11",
  plus: "M12 5v14 M5 12h14",
  minus: "M5 12h14",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5 M12 7v5l3 3",
  export: "M12 3v12 M7 10l5 5 5-5 M5 21h14",
  import: "M12 15V3 M7 8l5-5 5 5 M5 21h14",
  back: "M15 5l-7 7 7 7",
  undo: "M9 14L4 9l5-5 M4 9h11a5 5 0 0 1 0 10h-3",
  redo: "M15 14l5-5-5-5 M20 9H9a5 5 0 0 0 0 10h3",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z",
  left: "M14 6l-6 6 6 6",
  right: "M10 6l6 6-6 6",
  close: "M6 6l12 12 M18 6L6 18",
  image: "M4 5h16v14H4Z M4 16l5-5 4 4 3-3 4 4 M15 9.5a1.5 1.5 0 1 0 0-.01",
  video: "M3 6h12v12H3Z M15 10l6-3v10l-6-3",
  folder: "M3 6h6l2 2h10v11H3Z",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  eyeOff: "M3 3l18 18 M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.9 M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6 M9.9 9.9a3 3 0 0 0 4.2 4.2",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z M5 11a7 7 0 0 0 14 0 M12 18v3",
  spectrum: "M4 20v-6 M8 20V8 M12 20v-9 M16 20V5 M20 20v-4",
  sound: "M4 9h4l5-4v14l-5-4H4Z M16.5 9a4 4 0 0 1 0 6 M19 6.5a8 8 0 0 1 0 11",
  mute: "M4 9h4l5-4v14l-5-4H4Z M17 9.5l5 5 M22 9.5l-5 5",
  link: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
  unlink: "M17 13l3-3a5 5 0 0 0-7-7l-1 1 M7 11l-3 3a5 5 0 0 0 7 7l1-1 M3 3l18 18",
  layers: "M12 3l9 5-9 5-9-5Z M3 13l9 5 9-5 M3 17.5l9 5 9-5",
  grid: "M4 4h16v16H4Z M9.3 4v16 M14.7 4v16 M4 9.3h16 M4 14.7h16",
  more: "M6 10l6 6 6-6",
  film: "M4 4h16v16H4Z M8 4v16 M16 4v16 M4 8h4 M4 12h4 M4 16h4 M16 8h4 M16 12h4 M16 16h4",
  pointer: "M5 3l14 8-6.5 1.5L9 19Z",
  brush: "M4 20l1.2-4.8L15.5 4.9a2 2 0 0 1 2.8 0l.8.8a2 2 0 0 1 0 2.8L8.8 18.8Z M13.5 7l3.5 3.5",
  eraser: "M8 20l-4.3-4.3a1 1 0 0 1 0-1.4L13.3 4.7a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L12 20Z M8.5 9.5l6 6 M12 20h8",
  fill: "M5 11l7-7 8 8-7 7a2 2 0 0 1-2.8 0L5 13.8a2 2 0 0 1 0-2.8Z M5 12h15 M20 16s2 2.2 2 3.5a2 2 0 0 1-4 0c0-1.3 2-3.5 2-3.5Z",
  tint: "M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z M9 15a3 3 0 0 0 3 3",
  shape: "M3 21l7-7 M4 4h7v7H4Z M17.5 21a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  stamp: "M9 3h6v4a3 3 0 0 1-1 2l-1 1v3h6v4H5v-4h6v-3l-1-1a3 3 0 0 1-1-2Z M5 21h14",
  sculpt: "M4 17c3-6 6 2 9-4s4-6 7-5 M15 15a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z",
  lasso: "M12 4c4.4 0 8 2.2 8 5s-3.6 5-8 5c-1.2 0-2.3-.2-3.3-.5 M5.4 11.7C4.5 11 4 10 4 9c0-2.8 3.6-5 8-5 M6.5 12.5a1.8 1.8 0 1 0 0 .1 M6.6 14.3c.4 1.8-.6 3.2-2 4.2",
  picker: "M20.5 3.5a2.4 2.4 0 0 0-3.4 0L14 6.6l-1.3-1.3-1.4 1.4 1.3 1.3L5 15.6V19h3.4l7.6-7.6 1.3 1.3 1.4-1.4-1.3-1.3 3.1-3.1a2.4 2.4 0 0 0 0-3.4Z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
